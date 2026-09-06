import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { tools, searchFlights, searchHotels } from './agent-tools';
import { StopCategory } from '../generated/prisma/client';
import * as appInsights from 'applicationinsights';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import type {
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
  LlmToolResult,
} from './llm/llm-provider.interface';
import { trimHistory, truncateToolResult } from './llm/conversation-history';

interface SaveItineraryInput {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
  currency?: string;
  preferences?: string[];
  stops: {
    dayNumber: number;
    order: number;
    title: string;
    description?: string;
    category?: StopCategory;
    costCents?: number;
  }[];
}

const SYSTEM_PROMPT = `Du bist ein Reiseplaner-Assistent. Du hilfst Nutzern dabei, einen Reiseplan zu erstellen, indem du im Dialog Ziel, Reisedaten, Budget und Präferenzen erfragst.

Nutze die verfügbaren Werkzeuge:
- search_flights und search_hotels, um passende Optionen zu finden, sobald du Ziel, Zeitraum (Start-/Enddatum) und Budget kennst.
- save_itinerary, um den fertigen Plan zu speichern, sobald du gemeinsam mit dem Nutzer einen konkreten Tagesplan mit einzelnen Programmpunkten erarbeitet hast.

Frag aktiv nach fehlenden Informationen, bevor du ein Werkzeug aufrufst. Antworte immer auf Deutsch.`;

const saveItineraryTool: LlmToolDefinition = {
  name: 'save_itinerary',
  description:
    'Speichert einen fertigen Reiseplan in der Datenbank. Nur aufrufen, wenn Ziel, Zeitraum, Budget und mindestens ein paar Programmpunkte feststehen.',
  parameters: {
    type: 'object',
    properties: {
      destination: { type: 'string' },
      startDate: { type: 'string', description: 'YYYY-MM-DD' },
      endDate: { type: 'string', description: 'YYYY-MM-DD' },
      budgetCents: { type: 'integer' },
      currency: { type: 'string', description: 'z.B. EUR' },
      preferences: { type: 'array', items: { type: 'string' } },
      stops: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dayNumber: { type: 'integer' },
            order: { type: 'integer' },
            title: { type: 'string' },
            description: { type: 'string' },
            category: {
              type: 'string',
              enum: [
                'FOOD',
                'CULTURE',
                'SIGHTSEEING',
                'ACCOMMODATION',
                'TRANSPORT',
                'OTHER',
              ],
            },
            costCents: { type: 'integer' },
          },
          required: ['dayNumber', 'order', 'title', 'category'],
        },
      },
    },
    required: ['destination', 'startDate', 'endDate', 'budgetCents', 'stops'],
  },
};

const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? 4096);
const MAX_HISTORY_MESSAGES = Number(process.env.LLM_MAX_HISTORY_MESSAGES ?? 20);
const MAX_TOOL_RESULT_CHARS = Number(
  process.env.LLM_MAX_TOOL_RESULT_CHARS ?? 2000,
);

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly conversations = new Map<string, LlmMessage[]>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async sendMessage(sessionId: string, userMessage: string): Promise<string> {
    const history = this.getHistory(sessionId);
    history.push({ role: 'user', content: userMessage });

    let result = await this.callLlm(history);

    while (result.finishReason === 'tool_calls') {
      history.push({
        role: 'assistant',
        content: result.content ?? undefined,
        toolCalls: result.toolCalls,
      });

      const toolResults: LlmToolResult[] = [];
      for (const call of result.toolCalls) {
        const output = await this.executeTool(call.name, call.arguments);
        toolResults.push({
          toolCallId: call.id,
          content: truncateToolResult(
            JSON.stringify(output),
            MAX_TOOL_RESULT_CHARS,
          ),
        });
      }
      history.push({ role: 'tool', toolResults });

      result = await this.callLlm(history);
    }

    history.push({ role: 'assistant', content: result.content ?? '' });
    return result.content ?? '';
  }

  private async callLlm(history: LlmMessage[]) {
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...trimHistory(history, MAX_HISTORY_MESSAGES),
    ];
    const result = await this.llm.chat(messages, [...tools, saveItineraryTool], {
      maxTokens: MAX_TOKENS,
    });
    this.logger.log(
      `LLM-Aufruf: ${result.usage.inputTokens} Input-Tokens, ${result.usage.outputTokens} Output-Tokens`,
    );
    return result;
  }

  private getHistory(sessionId: string): LlmMessage[] {
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, []);
    }
    return this.conversations.get(sessionId)!;
  }

  private async executeTool(name: string, input: unknown) {
    switch (name) {
      case 'search_flights':
        return searchFlights(input as Parameters<typeof searchFlights>[0]);
      case 'search_hotels':
        return searchHotels(input as Parameters<typeof searchHotels>[0]);
      case 'save_itinerary':
        return this.saveItinerary(input as SaveItineraryInput);
      default:
        return { error: `Unbekanntes Tool: ${name}` };
    }
  }

  private async saveItinerary(input: SaveItineraryInput) {
    const user = await this.prisma.user.upsert({
      where: { email: 'guest@local.dev' },
      update: {},
      create: { email: 'guest@local.dev' },
    });

    const itinerary = await this.prisma.itinerary.create({
      data: {
        destination: input.destination,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        budgetCents: input.budgetCents,
        currency: input.currency ?? 'EUR',
        preferences: input.preferences ?? [],
        userId: user.id,
        stops: {
          create: input.stops.map((s) => ({
            dayNumber: s.dayNumber,
            order: s.order,
            title: s.title,
            description: s.description,
            category: s.category ?? 'OTHER',
            costCents: s.costCents,
          })),
        },
      },
      include: { stops: true },
    });
    appInsights.defaultClient?.trackEvent({
      name: 'ItinerarySaved',
      properties: {
        destination: input.destination,
        stopCount: String(input.stops.length),
      },
    });
    return { saved: true, itineraryId: itinerary.id };
  }
}
