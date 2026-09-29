import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AgentService } from './agent.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from './auth/current-user';
import { MAX_RETRY_AFTER_S } from './llm/retrying-llm-provider';
import {
  Orchestrator,
  RUN_TIMEOUT_MS,
  agentMode,
  agentModeLocked,
  resolveAgentMode,
} from './orchestrator/orchestrator';
import { RunEventEmitter, formatSse } from './runs/run-event-emitter';
import type { AgentMode, RunEvent, RunEventPayloads } from './runs/run-events';
import {
  AGENT_RUN_STORE,
  type AgentRunStore,
  type FinishedAgentRun,
  type FinishedRunStatus,
} from './runs/agent-run-store';

interface ChatRequest {
  sessionId: string;
  message: string;
}

// POST /agent/runs darf zusätzlich den Modus wählen (Umschalter im Chat)
interface RunRequest extends ChatRequest {
  mode?: AgentMode;
}

const AGENT_MODES: readonly AgentMode[] = ['classic', 'multi'];

// Jede Nachricht kostet LLM-Tokens (bei LLM_PROVIDER=anthropic echtes Geld),
// deshalb Token-Pflicht (Gäste bekommen es automatisch), Rate-Limit und
// Längengrenzen.
export const MAX_MESSAGE_LENGTH = 2000;
const MAX_SESSION_ID_LENGTH = 100;
// Der Ingress der Azure Container Apps kappt Verbindungen, über die eine
// Weile nichts fließt. Ein SSE-Kommentar alle 15 s hält sie offen, auch
// wenn ein LLM-Aufruf mal länger dauert.
const HEARTBEAT_MS = 15_000;

// Tageskontingent für Gäste: So viele LLM-Tokens darf ein Gastzugang in 24
// Stunden verbrauchen (Summe aus AgentRun). Ein voller Lauf im
// Multi-Agenten-Modus braucht etwa 5.000 bis 10.000, das reicht also für
// ein Dutzend Pläne. Schützt das Groq-Kontingent der Demo vor einem
// einzelnen Besucher. GUEST_DAILY_TOKEN_BUDGET=0 schaltet es ab; der
// Eigentümer (owner) hat kein Kontingent.
const DEFAULT_GUEST_DAILY_TOKEN_BUDGET = 60_000;
const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

export function guestDailyTokenBudget(): number {
  const raw = process.env.GUEST_DAILY_TOKEN_BUDGET;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_GUEST_DAILY_TOKEN_BUDGET;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_GUEST_DAILY_TOKEN_BUDGET;
}

// Wird geworfen, wenn ein Gast sein Tageskontingent aufgebraucht hat;
// toRunError macht daraus quota_exhausted mit eigener Meldung.
export class GuestQuotaExceededError extends Error {
  constructor(readonly budget: number) {
    super('Tageskontingent für Gäste aufgebraucht');
    this.name = 'GuestQuotaExceededError';
  }
}

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(
    private readonly agentService: AgentService,
    @Inject(AGENT_RUN_STORE) private readonly runStore: AgentRunStore,
    private readonly orchestrator: Orchestrator,
  ) {
    // Einmal beim Start ins Log, damit man lokal wie in Azure sofort sieht,
    // welcher Agent die Chats beantwortet (AGENT_MODE in apps/api/.env) und
    // ob Clients ihn per Umschalter wählen dürfen (AGENT_MODE_LOCKED).
    this.logger.log(
      `Agentenmodus für POST /agent/runs: ${agentMode()} (${
        agentModeLocked()
          ? 'gesperrt, Wahl des Clients wird ignoriert'
          : 'Default, Client kann per mode wählen'
      })`,
    );
  }

  // Antwortet erst, wenn der Agent fertig ist, mit einem JSON. Bleibt für
  // Evals, den MCP-Server und ältere Clients.
  @Post('chat')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async chat(@CurrentUser() user: AuthUser, @Body() body: ChatRequest) {
    const { sessionId, message } = parseChatRequest(body);
    try {
      await this.checkGuestQuota(user);
      return await this.agentService.sendMessage(
        user.userId,
        sessionId,
        message,
      );
    } catch (error) {
      // Rate-Limit des LLM-Anbieters als 429 mit verständlicher Meldung statt
      // als nichtssagende 500
      const runError = toRunError(error);
      if (runError.code === 'internal') throw error;
      throw new HttpException(runError, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  // Derselbe Agent (bzw. mit mode 'multi' der Orchestrator mit Planer,
  // Recherche und Budget), aber jeder Schritt kommt sofort als Server-Sent Event.
  // Ohne mode im Body gilt AGENT_MODE, mit AGENT_MODE_LOCKED=true immer.
  // Der Stream läuft in DERSELBEN Antwort, die den Lauf startet: Bei bis zu
  // drei API-Instanzen könnte ein zweiter Request (z. B. GET /events) auf
  // einer anderen Instanz landen, die vom Lauf nichts weiß.
  @Post('runs')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async run(
    @CurrentUser() user: AuthUser,
    @Body() body: RunRequest,
    @Res() res: Response,
  ): Promise<void> {
    // Vor dem ersten Byte prüfen: Ungültige Anfragen bekommen so noch eine
    // normale 400 statt eines Streams.
    const { sessionId, message } = parseChatRequest(body);
    const requestedMode = parseMode(body?.mode);

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Verhindert, dass ein Proxy die Ereignisse sammelt und gebündelt schickt
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Schließt der Nutzer den Tab, läuft der Agent zu Ende (der Verlauf wird
    // trotzdem gespeichert), es wird nur nichts mehr geschrieben.
    let open = true;
    res.on('close', () => {
      open = false;
    });
    const write = (chunk: string) => {
      if (open) res.write(chunk);
    };
    const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS);
    // Alle Ereignisse gehen sofort an den Client und zusätzlich in einen
    // Puffer, der am Ende EINMAL gespeichert wird (Replay unter /replay).
    // Ein Schreibzugriff pro Ereignis würde jeden Lauf um Dutzende
    // Datenbank-Roundtrips verlangsamen.
    const recorded: RunEvent[] = [];
    const events = new RunEventEmitter((event) => {
      recorded.push(event);
      write(formatSse(event));
    });
    // Vorab erzeugt, damit das Frontend den Replay-Link schon mit
    // run.started kennt und nicht auf das Speichern warten muss.
    const runId = randomUUID();
    const createdAt = new Date();
    let status: FinishedRunStatus = 'OK';
    // Pro Lauf gelesen: Default und Notbremse brauchen nur einen Neustart mit
    // anderer Umgebungsvariable, Tests setzen sie direkt. run.started meldet
    // den tatsächlich genutzten Modus.
    const mode = resolveAgentMode(requestedMode);

    try {
      events.emit('run.started', { runId, mode });
      await this.checkGuestQuota(user);
      const result =
        mode === 'multi'
          ? await this.orchestrator.run(
              { runId, userId: user.userId, sessionId, message },
              (type, data) => events.emit(type, data),
              AbortSignal.timeout(RUN_TIMEOUT_MS),
            )
          : await this.agentService.sendMessage(
              user.userId,
              sessionId,
              message,
              events,
            );
      if (result.route) {
        events.emit('stops.updated', { stops: result.route });
      }
      events.emit('sources', {
        sources: result.sources,
        searchAttempted: result.searchAttempted,
      });
      events.emit('message.completed', { text: result.reply });
      events.emit('run.finished', { totals: events.totals() });
    } catch (error) {
      // Der Status 200 ist schon raus, Fehler gehen deshalb als Ereignis
      // an den Client statt als HTTP-Status.
      if (error instanceof GuestQuotaExceededError) {
        this.logger.warn(`Gast ${user.userId}: Tageskontingent aufgebraucht`);
      } else {
        this.logger.error('Agentenlauf fehlgeschlagen', error);
      }
      events.emit('run.error', toRunError(error));
      status = 'ERROR';
    } finally {
      clearInterval(heartbeat);
      // Hat der Client die Verbindung vorher geschlossen, lief der Agent
      // trotzdem zu Ende; ABORTED heißt nur: niemand hat das Ende gesehen.
      if (status === 'OK' && !open) status = 'ABORTED';
      res.end();
    }

    // Nach res.end(): Der Client wartet nicht auf die Datenbank.
    await this.saveRun({
      id: runId,
      userId: user.userId,
      sessionId,
      status,
      totals: events.totals(),
      events: recorded,
      createdAt,
      finishedAt: new Date(),
    });
  }

  // Ein gespeicherter Lauf zum erneuten Abspielen (/replay?run=<id>). Nur
  // für den Eigentümer: message.completed enthält die Antwort auf seine
  // Frage. Fremde und unbekannte IDs sind beide 404, damit sich nicht
  // herausfinden lässt, welche IDs es gibt.
  @Get('runs/:id')
  async findRun(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const run = await this.runStore.findForUser(user.userId, id);
    if (!run) throw new NotFoundException('Lauf nicht gefunden');
    return run;
  }

  // Gäste: Kontingent aus den gespeicherten Läufen der letzten 24 Stunden.
  // Gezählt werden die Läufe über POST /agent/runs (nur die werden
  // gespeichert); geprüft wird vor jedem Lauf, ein laufender wird nicht
  // abgebrochen.
  private async checkGuestQuota(user: AuthUser): Promise<void> {
    const budget = guestDailyTokenBudget();
    if (user.role !== 'guest' || budget === 0) return;
    const used = await this.runStore.tokensSince(
      user.userId,
      new Date(Date.now() - QUOTA_WINDOW_MS),
    );
    if (used >= budget) throw new GuestQuotaExceededError(budget);
  }

  // Ein fehlgeschlagenes Speichern kostet nur das Replay, nicht den Lauf:
  // Die Antwort ist zu diesem Zeitpunkt schon beim Nutzer.
  private async saveRun(run: FinishedAgentRun): Promise<void> {
    try {
      await this.runStore.save(run);
    } catch (error) {
      this.logger.warn(`Agentenlauf ${run.id} nicht gespeichert: ${error}`);
    }
  }
}

function parseChatRequest(body: ChatRequest | undefined): ChatRequest {
  const { sessionId, message } = body ?? {};
  if (
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    sessionId.length > MAX_SESSION_ID_LENGTH
  ) {
    throw new BadRequestException('sessionId fehlt oder ist zu lang');
  }
  if (
    typeof message !== 'string' ||
    message.trim().length === 0 ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    throw new BadRequestException(
      `message muss 1 bis ${MAX_MESSAGE_LENGTH} Zeichen lang sein`,
    );
  }
  return { sessionId, message };
}

// mode ist optional; alles außer 'classic' und 'multi' ist ein Fehler, damit
// ein Tippfehler im Client nicht still beim Default landet.
function parseMode(mode: unknown): AgentMode | undefined {
  if (mode === undefined || mode === null) return undefined;
  if (typeof mode === 'string' && AGENT_MODES.includes(mode as AgentMode)) {
    return mode as AgentMode;
  }
  throw new BadRequestException("mode muss 'classic' oder 'multi' sein");
}

// Drei Fälle unterscheidet das Frontend. Die Fehlermeldung selbst bleibt im
// Server-Log, damit keine Interna (Provider, Stacktrace) nach außen gehen.
export function toRunError(error: unknown): RunEventPayloads['run.error'] {
  if (error instanceof GuestQuotaExceededError) {
    return {
      code: 'quota_exhausted',
      message: `Das Tageskontingent für Gastzugänge (${error.budget.toLocaleString('de-DE')} Tokens in 24 Stunden) ist aufgebraucht. Versuch es in ein paar Stunden noch einmal.`,
    };
  }
  const { status, headers } =
    (error as { status?: unknown; headers?: unknown } | null) ?? {};
  if (status !== 429) {
    return {
      code: 'internal',
      message:
        'Der Reiseplaner ist gerade nicht erreichbar. Versuch es bitte gleich noch einmal.',
    };
  }
  const retryAfter = retryAfterSeconds(headers);
  // Über dieser Wartezeit hat RetryingLlmProvider gar nicht erst gewartet:
  // Kontingent aufgebraucht, "warte kurz" wäre irreführend.
  if (retryAfter !== undefined && retryAfter > MAX_RETRY_AFTER_S) {
    const minutes = Math.ceil(retryAfter / 60);
    return {
      code: 'quota_exhausted',
      message: `Das Kontingent des KI-Dienstes ist gerade aufgebraucht. Versuch es in etwa ${minutes} ${minutes === 1 ? 'Minute' : 'Minuten'} noch einmal.`,
    };
  }
  return {
    code: 'rate_limited',
    message:
      'Gerade kommen zu viele Anfragen an. Warte kurz und versuch es dann noch einmal.',
  };
}

// Die SDKs liefern Header als Headers-Objekt (OpenAI/Groq, Anthropic) oder
// als einfaches Objekt; beides abdecken.
function retryAfterSeconds(headers: unknown): number | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const raw =
    typeof (headers as Headers).get === 'function'
      ? (headers as Headers).get('retry-after')
      : (headers as Record<string, unknown>)['retry-after'];
  const seconds = Number(raw);
  return raw != null && Number.isFinite(seconds) ? seconds : undefined;
}
