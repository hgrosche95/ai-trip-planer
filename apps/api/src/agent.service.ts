import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from './prisma.service';
import { tools, searchFlights, searchHotels } from './agent-tools';
import { StopCategory } from '../generated/prisma/client';

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

const saveItineraryTool: Anthropic.Tool = {
  name: 'save_itinerary',
  description:
    'Speichert einen fertigen Reiseplan in der Datenbank. Nur aufrufen, wenn Ziel, Zeitraum, Budget und mindestens ein paar Programmpunkte feststehen.',
  input_schema: {
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

@Injectable()
export class AgentService {
  private readonly anthropic = new Anthropic();
  private readonly conversations = new Map<string, Anthropic.MessageParam[]>();

  constructor(private readonly prisma: PrismaService) {}

  async sendMessage(sessionId: string, userMessage: string): Promise<string> {
    const history = this.getHistory(sessionId);
    history.push({ role: 'user', content: userMessage });

    let response = await this.callClaude(history);

    while (response.stop_reason === 'tool_use') {
      history.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === 'tool_use') {
          const result = await this.executeTool(block.name, block.input);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        }
      }
      history.push({ role: 'user', content: toolResults });

      response = await this.callClaude(history);
    }

    history.push({ role: 'assistant', content: response.content });

    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );
    return textBlock?.text ?? '';
  }

  private callClaude(history: Anthropic.MessageParam[]) {
    return this.anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [...tools, saveItineraryTool],
      messages: history,
    });
  }

  private getHistory(sessionId: string): Anthropic.MessageParam[] {
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

    return { saved: true, itineraryId: itinerary.id };
  }
}
