import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
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
import { RunEventEmitter, formatSse } from './runs/run-event-emitter';
import type { RunEventPayloads } from './runs/run-events';

interface ChatRequest {
  sessionId: string;
  message: string;
}

// Jede Nachricht kostet LLM-Tokens (bei LLM_PROVIDER=anthropic echtes Geld),
// deshalb Token-Pflicht (Gäste bekommen es automatisch), Rate-Limit und
// Längengrenzen.
export const MAX_MESSAGE_LENGTH = 2000;
const MAX_SESSION_ID_LENGTH = 100;
// Der Ingress der Azure Container Apps kappt Verbindungen, über die eine
// Weile nichts fließt. Ein SSE-Kommentar alle 15 s hält sie offen, auch
// wenn ein LLM-Aufruf mal länger dauert.
const HEARTBEAT_MS = 15_000;

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentService: AgentService) {}

  // Antwortet erst, wenn der Agent fertig ist, mit einem JSON. Bleibt für
  // Evals, den MCP-Server und ältere Clients.
  @Post('chat')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async chat(@CurrentUser() user: AuthUser, @Body() body: ChatRequest) {
    const { sessionId, message } = parseChatRequest(body);
    try {
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

  // Derselbe Agent, aber jeder Schritt kommt sofort als Server-Sent Event.
  // Der Stream läuft in DERSELBEN Antwort, die den Lauf startet: Bei bis zu
  // drei API-Instanzen könnte ein zweiter Request (z. B. GET /events) auf
  // einer anderen Instanz landen, die vom Lauf nichts weiß.
  @Post('runs')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async run(
    @CurrentUser() user: AuthUser,
    @Body() body: ChatRequest,
    @Res() res: Response,
  ): Promise<void> {
    // Vor dem ersten Byte prüfen: Ungültige Anfragen bekommen so noch eine
    // normale 400 statt eines Streams.
    const { sessionId, message } = parseChatRequest(body);

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
    const events = new RunEventEmitter((event) => write(formatSse(event)));

    try {
      events.emit('run.started', {});
      const result = await this.agentService.sendMessage(
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
      this.logger.error('Agentenlauf fehlgeschlagen', error);
      events.emit('run.error', toRunError(error));
    } finally {
      clearInterval(heartbeat);
      res.end();
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

// Drei Fälle unterscheidet das Frontend. Die Fehlermeldung selbst bleibt im
// Server-Log, damit keine Interna (Provider, Stacktrace) nach außen gehen.
export function toRunError(error: unknown): RunEventPayloads['run.error'] {
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
