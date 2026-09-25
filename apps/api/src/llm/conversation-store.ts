import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import type { LlmMessage } from './llm-provider.interface';
import { trimHistory } from './conversation-history';

export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');

// Wo der Chat-Verlauf liegt. Eigene Schnittstelle, damit AgentService nichts
// von Prisma wissen muss und Tests einen Speicher im Arbeitsspeicher nutzen können.
export interface ConversationStore {
  load(userId: string, sessionId: string): Promise<LlmMessage[]>;
  save(
    userId: string,
    sessionId: string,
    messages: LlmMessage[],
  ): Promise<void>;
}

// Mehr als das LLM pro Aufruf sieht (LLM_MAX_HISTORY_MESSAGES, Default 20),
// damit nach dem Kürzen noch Kontext übrig ist, aber eine Unterhaltung nicht
// unbegrenzt wächst.
const MAX_STORED_MESSAGES = Number(process.env.LLM_MAX_STORED_MESSAGES ?? 40);
// Unterhaltungen, die so lange nicht fortgesetzt wurden, werden gelöscht.
// Chat-Inhalte können persönliche Angaben enthalten ("Hochzeitsreise mit
// Anna"), die nicht ohne Grund unbegrenzt liegen sollen, und die Datenbank
// soll nicht mit jedem Gast weiter wachsen.
const CONVERSATION_RETENTION_DAYS = Number(
  process.env.CONVERSATION_RETENTION_DAYS ?? 30,
);
// Aufgeräumt wird beim Speichern statt per Zeitplan: Die API skaliert auf 0,
// ein Timer im Prozess würde dann meist gar nicht laufen. Höchstens einmal pro
// Stunde, damit nicht jede Chat-Nachricht eine Löschabfrage auslöst.
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PrismaConversationStore implements ConversationStore {
  private readonly logger = new Logger(PrismaConversationStore.name);
  // Zeitpunkt des letzten Aufräumens (ms seit 1970), 0 = noch nie
  private lastCleanup = 0;
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: string, sessionId: string): Promise<LlmMessage[]> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { userId_sessionId: { userId, sessionId } },
    });
    return (conversation?.messages as LlmMessage[] | undefined) ?? [];
  }

  async save(
    userId: string,
    sessionId: string,
    messages: LlmMessage[],
  ): Promise<void> {
    const trimmed = trimHistory(
      messages,
      MAX_STORED_MESSAGES,
    ) as unknown as Prisma.InputJsonValue;
    await this.prisma.conversation.upsert({
      where: { userId_sessionId: { userId, sessionId } },
      create: { userId, sessionId, messages: trimmed },
      update: { messages: trimmed },
    });
    await this.deleteExpired();
  }

  private async deleteExpired(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCleanup < CLEANUP_INTERVAL_MS) return;
    // Vor dem await setzen: Kommen zwei Nachrichten gleichzeitig, räumt nur
    // die erste auf.
    this.lastCleanup = now;

    const cutoff = new Date(now - CONVERSATION_RETENTION_DAYS * DAY_MS);
    try {
      const { count } = await this.prisma.conversation.deleteMany({
        where: { updatedAt: { lt: cutoff } },
      });
      if (count > 0) {
        this.logger.log(`${count} alte Chat-Verläufe gelöscht`);
      }
    } catch (error) {
      // Aufräumen ist Nebensache: Schlägt es fehl, soll der Chat trotzdem
      // antworten. Beim nächsten Intervall wird es erneut versucht.
      this.logger.warn(
        `Aufräumen alter Chat-Verläufe fehlgeschlagen: ${error}`,
      );
    }
  }
}
