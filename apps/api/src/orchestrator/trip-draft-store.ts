import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { CONVERSATION_RETENTION_DAYS } from '../llm/conversation-store';
import type { BudgetReport } from './agents/budget.agent';
import type { ResearchFindings, TripBrief, TripDraft } from './trip-draft';

export const TRIP_DRAFT_STORE = Symbol('TRIP_DRAFT_STORE');

// Der letzte Entwurf einer Session mit allem, was eine Überarbeitung
// braucht: Eckdaten, Tagesplan, Recherche (damit "Tag 2 entspannter" nicht
// neu recherchiert) und Budget. revision zählt die Fassungen (1 = erster
// Plan der Session, jede Überarbeitung +1, eine neue Reise wieder 1).
export interface StoredTripDraft {
  revision: number;
  brief: TripBrief;
  draft: TripDraft;
  findings: ResearchFindings;
  budget?: BudgetReport;
}

// Wo die Entwürfe liegen. Eigene Schnittstelle wie beim ConversationStore:
// Der Orchestrator kennt Prisma nicht, Tests nutzen InMemoryTripDraftStore.
export interface TripDraftStore {
  // null, wenn die Session (dieses Nutzers) noch keinen Entwurf hat
  load(userId: string, sessionId: string): Promise<StoredTripDraft | null>;
  // Ersetzt den Entwurf der Session
  save(
    userId: string,
    sessionId: string,
    value: StoredTripDraft,
  ): Promise<void>;
}

// Aufgeräumt wird beim Schreiben statt per Zeitplan (Scale-to-Zero, siehe
// PrismaConversationStore), höchstens einmal pro Stunde.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PrismaTripDraftStore implements TripDraftStore {
  private readonly logger = new Logger(PrismaTripDraftStore.name);
  // Zeitpunkt des letzten Aufräumens (ms seit 1970), 0 = noch nie
  private lastCleanup = 0;
  constructor(private readonly prisma: PrismaService) {}

  async load(
    userId: string,
    sessionId: string,
  ): Promise<StoredTripDraft | null> {
    const row = await this.prisma.tripDraft.findUnique({
      where: { userId_sessionId: { userId, sessionId } },
    });
    if (!row) return null;
    return {
      revision: row.revision,
      brief: row.brief as unknown as TripBrief,
      draft: row.draft as unknown as TripDraft,
      findings: row.findings as unknown as ResearchFindings,
      ...(row.budget !== null && {
        budget: row.budget as unknown as BudgetReport,
      }),
    };
  }

  async save(
    userId: string,
    sessionId: string,
    value: StoredTripDraft,
  ): Promise<void> {
    const data = {
      revision: value.revision,
      brief: json(value.brief),
      draft: json(value.draft),
      findings: json(value.findings),
      budget: value.budget ? json(value.budget) : undefined,
    };
    await this.prisma.tripDraft.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      create: { userId, sessionId, ...data },
      // Ohne Budget: altes Budget entfernen statt stehen lassen
      update: { ...data, budget: data.budget ?? Prisma.DbNull },
    });
    await this.deleteExpired();
  }

  // Entwürfe enthalten Ziel und Vorlieben des Nutzers. Sie liegen deshalb
  // nicht länger als die Chat-Verläufe (CONVERSATION_RETENTION_DAYS).
  private async deleteExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    // Vor dem await setzen: Enden zwei Läufe gleichzeitig, räumt nur der
    // erste auf.
    this.lastCleanup = now;

    const cutoff = new Date(now - CONVERSATION_RETENTION_DAYS * DAY_MS);
    try {
      const { count } = await this.prisma.tripDraft.deleteMany({
        where: { updatedAt: { lt: cutoff } },
      });
      if (count > 0) this.logger.log(`${count} alte Entwürfe gelöscht`);
    } catch (error) {
      // Aufräumen ist Nebensache: Der Lauf ist trotzdem fertig, beim
      // nächsten Intervall wird es erneut versucht.
      this.logger.warn(`Aufräumen alter Entwürfe fehlgeschlagen: ${error}`);
    }
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

// Für Tests: hält die Entwürfe in einer Map. Kopiert beim Lesen und
// Schreiben, damit ein Lauf den gespeicherten Stand nicht nachträglich
// verändert (wie beim Umweg über JSON in der Datenbank).
export class InMemoryTripDraftStore implements TripDraftStore {
  readonly drafts = new Map<string, StoredTripDraft>();

  load(userId: string, sessionId: string): Promise<StoredTripDraft | null> {
    const value = this.drafts.get(`${userId}:${sessionId}`);
    return Promise.resolve(value ? structuredClone(value) : null);
  }

  save(
    userId: string,
    sessionId: string,
    value: StoredTripDraft,
  ): Promise<void> {
    this.drafts.set(`${userId}:${sessionId}`, structuredClone(value));
    return Promise.resolve();
  }
}
