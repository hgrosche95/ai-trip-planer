import { Injectable } from '@nestjs/common';
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

@Injectable()
export class PrismaConversationStore implements ConversationStore {
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
  }
}
