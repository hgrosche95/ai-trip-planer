import { Inject, Injectable, Logger } from '@nestjs/common';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { ItinerariesService } from './itineraries.service';
import type { CreateItineraryInput } from './itineraries.service';
import {
  tools,
  searchFlights,
  searchHotels,
  searchTravelKnowledge,
} from './agent-tools';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import type {
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
  LlmToolResult,
} from './llm/llm-provider.interface';
import { trimHistory, truncateToolResult } from './llm/conversation-history';
import type { TravelKnowledgeSearchResult } from './rag-client';

export interface ChatSource {
  title: string;
  source: string;
  license: string;
  url: string | null;
  score: number;
}

export interface ChatResult {
  reply: string;
  sources: ChatSource[];
  // true, sobald search_travel_knowledge mindestens einmal aufgerufen wurde -
  // unabhängig davon, ob es Treffer geliefert hat. Trennt "Frage brauchte
  // keine Wissensbasis" (z.B. Small Talk) von "Wissensbasis wurde befragt,
  // aber nichts Passendes gefunden" - im Frontend zwei unterschiedliche
  // UI-Botschaften (siehe apps/web).
  searchAttempted: boolean;
}

const SYSTEM_PROMPT = `Du bist ein Reiseplaner-Assistent. Du hilfst Nutzern dabei, einen Reiseplan zu erstellen, indem du im Dialog Ziel, Reisedaten, Budget und Präferenzen erfragst.

Nutze die verfügbaren Werkzeuge:
- search_travel_knowledge, um Faktenfragen zu einem Reiseziel (Sehenswürdigkeiten, Essen & Trinken, Transport) zu beantworten. Nutze es, BEVOR du aus dem Gedächtnis antwortest, und belege deine Aussage mit der zurückgegebenen Quelle (Titel + Quelle). Liefert es keine passenden Treffer, sag das ehrlich, statt zu raten oder zu spekulieren.
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
    private readonly itinerariesService: ItinerariesService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async sendMessage(
    sessionId: string,
    userMessage: string,
  ): Promise<ChatResult> {
    // propagateAttributes markiert alle Spans dieses Trace mit der Session -
    // so lassen sich in Langfuse alle Agentenläufe einer Konversation
    // zusammenhängend ansehen. Bewusst KEIN userMessage/reply-Text als
    // Trace-Input/Output (siehe README "Was wird nicht getraced und warum"):
    // Chat-Nachrichten können Reisepräferenzen oder andere persönliche
    // Angaben enthalten, die nichts in einem Drittanbieter-Dashboard
    // verloren haben. Getraced wird nur die Form des Laufs - Tokens,
    // Latenz, welche Tools mit welchem Ergebnis-Umfang liefen.
    return propagateAttributes({ sessionId }, () =>
      startActiveObservation('chat-message', async (turn) => {
        const history = this.getHistory(sessionId);
        history.push({ role: 'user', content: userMessage });

        let result = await this.callLlm(history);
        const sources = new Map<string, ChatSource>();
        let searchAttempted = false;

        while (result.finishReason === 'tool_calls') {
          history.push({
            role: 'assistant',
            content: result.content ?? undefined,
            toolCalls: result.toolCalls,
          });

          const toolResults: LlmToolResult[] = [];
          for (const call of result.toolCalls) {
            const output = await this.executeTool(call.name, call.arguments);
            if (call.name === 'search_travel_knowledge') {
              searchAttempted = true;
              this.collectSources(
                output as TravelKnowledgeSearchResult,
                sources,
              );
            }
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
        turn.update({
          metadata: { searchAttempted, sourceCount: sources.size },
        });
        return {
          reply: result.content ?? '',
          sources: [...sources.values()].sort((a, b) => b.score - a.score),
          searchAttempted,
        };
      }),
    );
  }

  private collectSources(
    knowledgeResult: TravelKnowledgeSearchResult,
    sources: Map<string, ChatSource>,
  ): void {
    for (const hit of knowledgeResult.results) {
      // Dedupe-Schlüssel aus Titel+Score statt Content: mehrere
      // search_travel_knowledge-Aufrufe in derselben Runde (z.B. eine Frage
      // zu Essen UND Transport) liefern oft überlappende Chunks - die
      // Quellenliste im Frontend soll jede Quelle nur einmal zeigen.
      sources.set(`${hit.title}|${hit.score}`, {
        title: hit.title,
        source: hit.source,
        license: hit.license,
        url: hit.url,
        score: hit.score,
      });
    }
  }

  private async callLlm(history: LlmMessage[]) {
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...trimHistory(history, MAX_HISTORY_MESSAGES),
    ];
    return startActiveObservation(
      'llm-call',
      async (generation) => {
        const result = await this.llm.chat(
          messages,
          [...tools, saveItineraryTool],
          {
            maxTokens: MAX_TOKENS,
          },
        );
        generation.update({
          model: result.model,
          usageDetails: {
            input: result.usage.inputTokens,
            output: result.usage.outputTokens,
          },
          metadata: { finishReason: result.finishReason },
        });
        this.logger.log(
          `LLM-Aufruf: ${result.usage.inputTokens} Input-Tokens, ${result.usage.outputTokens} Output-Tokens`,
        );
        return result;
      },
      { asType: 'generation' },
    );
  }

  private getHistory(sessionId: string): LlmMessage[] {
    if (!this.conversations.has(sessionId)) {
      this.conversations.set(sessionId, []);
    }
    return this.conversations.get(sessionId)!;
  }

  private async executeTool(name: string, input: unknown) {
    // search_travel_knowledge bekommt einen eigenen Observation-Typ
    // ("retriever" statt "tool"), weil es der Retrieval-Schritt aus dem
    // Plan ist - in Langfuse taucht er dadurch mit den Top-Treffern
    // (Titel/Quelle/Score, keine Nutzerdaten) statt als generischer
    // Tool-Aufruf auf.
    if (name === 'search_travel_knowledge') {
      return startActiveObservation(
        'search_travel_knowledge',
        async (retriever) => {
          const result = await searchTravelKnowledge(
            (input as { query: string }).query,
          );
          retriever.update({
            output: result.results.map((hit) => ({
              title: hit.title,
              source: hit.source,
              score: hit.score,
            })),
            metadata: {
              available: result.available,
              hitCount: result.results.length,
            },
          });
          return result;
        },
        { asType: 'retriever' },
      );
    }

    return startActiveObservation(
      name,
      async (tool) => {
        const output = await this.runTool(name, input);
        tool.update({ metadata: { hasError: 'error' in (output as object) } });
        return output;
      },
      { asType: 'tool' },
    );
  }

  private async runTool(name: string, input: unknown) {
    switch (name) {
      case 'search_flights':
        return searchFlights(input as Parameters<typeof searchFlights>[0]);
      case 'search_hotels':
        return searchHotels(input as Parameters<typeof searchHotels>[0]);
      case 'save_itinerary':
        return this.saveItinerary(input as CreateItineraryInput);
      default:
        return { error: `Unbekanntes Tool: ${name}` };
    }
  }

  private async saveItinerary(input: CreateItineraryInput) {
    const itinerary = await this.itinerariesService.create(input);
    return { saved: true, itineraryId: itinerary.id };
  }
}
