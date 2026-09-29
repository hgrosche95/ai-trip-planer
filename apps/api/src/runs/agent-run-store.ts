import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { CONVERSATION_RETENTION_DAYS } from '../llm/conversation-store';
import type { RunEvent, RunTotals } from './run-events';

export const AGENT_RUN_STORE = Symbol('AGENT_RUN_STORE');

// Ausgang eines Laufs. RUNNING gibt es im Datenmodell auch, wird aber nie
// geschrieben: gespeichert wird erst am Ende.
export type FinishedRunStatus = 'OK' | 'ERROR' | 'ABORTED';

export interface FinishedAgentRun {
  id: string;
  userId: string;
  sessionId: string;
  status: FinishedRunStatus;
  totals: RunTotals;
  events: RunEvent[];
  createdAt: Date;
  finishedAt: Date;
}

// Was GET /agent/runs/:id liefert: genug, um den Lauf abzuspielen
export interface StoredAgentRun {
  id: string;
  createdAt: Date;
  status: 'running' | 'ok' | 'error' | 'aborted';
  totals: RunTotals;
  events: RunEvent[];
}

// Wo abgeschlossene Agentenläufe liegen. Eigene Schnittstelle wie beim
// ConversationStore: Der Controller kennt Prisma nicht, und Tests nutzen
// InMemoryAgentRunStore.
export interface AgentRunStore {
  save(run: FinishedAgentRun): Promise<void>;
  // null, wenn es den Lauf nicht gibt ODER er einem anderen Nutzer gehört:
  // Die Ereignisse enthalten mit message.completed Nutzertext.
  findForUser(userId: string, id: string): Promise<StoredAgentRun | null>;
  // Summe der LLM-Tokens (Eingabe + Ausgabe) aller Läufe des Nutzers seit
  // `since`, für das Tageskontingent der Gäste
  tokensSince(userId: string, since: Date): Promise<number>;
}

// Ein Lauf hat realistisch 60 bis 150 Ereignisse (Plan 2.4). Die Grenze
// schützt die Datenbank vor Ausreißern, etwa einer Tool-Schleife.
export const MAX_STORED_EVENTS = 500;
// So viele Ereignisse vom Ende bleiben beim Kürzen immer erhalten: Dort
// stehen stops.updated, sources, die Antwort und run.finished/run.error,
// ohne die ein Replay kein Ergebnis zeigen würde.
const KEPT_TAIL_EVENTS = 10;

// Kürzt die Ereignisliste auf höchstens `max` Einträge. Behalten werden der
// Anfang (Ablauf bis zur Grenze) und das Ende (Ergebnis); die Mitte fällt
// weg. Schritte, deren Abschluss in der Mitte lag, erscheinen im Replay
// dann als nicht beendet - bei einem Ausreißer vertretbar.
export function capEvents(
  events: RunEvent[],
  max = MAX_STORED_EVENTS,
): RunEvent[] {
  if (events.length <= max) return events;
  const tail = Math.min(KEPT_TAIL_EVENTS, max);
  return [...events.slice(0, max - tail), ...events.slice(-tail)];
}

// Kosten als ganze Mikro-US-Dollar (1 = 0,000001 $), wie budgetCents
// ganzzahlig, damit Summen in der Datenbank nicht mit Float-Fehlern rechnen.
export function toMicroUsd(usd: number): number {
  return Math.round(usd * 1_000_000);
}

// Aufgeräumt wird beim Schreiben statt per Zeitplan (Scale-to-Zero, siehe
// PrismaConversationStore), höchstens einmal pro Stunde.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PrismaAgentRunStore implements AgentRunStore {
  private readonly logger = new Logger(PrismaAgentRunStore.name);
  // Zeitpunkt des letzten Aufräumens (ms seit 1970), 0 = noch nie
  private lastCleanup = 0;
  constructor(private readonly prisma: PrismaService) {}

  async save(run: FinishedAgentRun): Promise<void> {
    await this.prisma.agentRun.create({
      data: {
        id: run.id,
        userId: run.userId,
        sessionId: run.sessionId,
        status: run.status,
        llmCalls: run.totals.llmCalls,
        toolCalls: run.totals.toolCalls,
        inputTokens: run.totals.inputTokens,
        outputTokens: run.totals.outputTokens,
        costMicroUsd: toMicroUsd(run.totals.costUsd),
        durationMs: run.totals.durationMs,
        events: capEvents(run.events) as unknown as Prisma.InputJsonValue,
        createdAt: run.createdAt,
        finishedAt: run.finishedAt,
      },
    });
    await this.deleteExpired();
  }

  async findForUser(
    userId: string,
    id: string,
  ): Promise<StoredAgentRun | null> {
    // Nutzer in der Bedingung statt danach prüfen: Ein fremder Lauf ist
    // von einem nicht vorhandenen nicht zu unterscheiden.
    const run = await this.prisma.agentRun.findFirst({
      where: { id, userId },
    });
    if (!run) return null;
    return {
      id: run.id,
      createdAt: run.createdAt,
      status: run.status.toLowerCase() as StoredAgentRun['status'],
      totals: {
        llmCalls: run.llmCalls,
        toolCalls: run.toolCalls,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        costUsd: run.costMicroUsd / 1_000_000,
        durationMs: run.durationMs ?? 0,
      },
      events: run.events as unknown as RunEvent[],
    };
  }

  async tokensSince(userId: string, since: Date): Promise<number> {
    const { _sum } = await this.prisma.agentRun.aggregate({
      where: { userId, createdAt: { gte: since } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return (_sum.inputTokens ?? 0) + (_sum.outputTokens ?? 0);
  }

  // Läufe enthalten mit message.completed die Antwort und damit indirekt,
  // was der Nutzer gefragt hat. Sie liegen deshalb nicht länger als die
  // Chat-Verläufe (CONVERSATION_RETENTION_DAYS, Default 30).
  private async deleteExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    // Vor dem await setzen: Enden zwei Läufe gleichzeitig, räumt nur der
    // erste auf.
    this.lastCleanup = now;

    const cutoff = new Date(now - CONVERSATION_RETENTION_DAYS * DAY_MS);
    try {
      const { count } = await this.prisma.agentRun.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      if (count > 0) this.logger.log(`${count} alte Agentenläufe gelöscht`);
    } catch (error) {
      this.logger.warn(`Aufräumen alter Agentenläufe fehlgeschlagen: ${error}`);
    }
  }
}

// Für Tests: hält die Läufe in einer Map.
export class InMemoryAgentRunStore implements AgentRunStore {
  readonly runs = new Map<string, FinishedAgentRun>();

  save(run: FinishedAgentRun): Promise<void> {
    this.runs.set(run.id, { ...run, events: capEvents(run.events) });
    return Promise.resolve();
  }

  findForUser(userId: string, id: string): Promise<StoredAgentRun | null> {
    const run = this.runs.get(id);
    if (!run || run.userId !== userId) return Promise.resolve(null);
    return Promise.resolve({
      id: run.id,
      createdAt: run.createdAt,
      status: run.status.toLowerCase() as StoredAgentRun['status'],
      totals: run.totals,
      events: run.events,
    });
  }

  tokensSince(userId: string, since: Date): Promise<number> {
    let sum = 0;
    for (const run of this.runs.values()) {
      if (run.userId === userId && run.createdAt >= since) {
        sum += run.totals.inputTokens + run.totals.outputTokens;
      }
    }
    return Promise.resolve(sum);
  }
}
