import { Inject, Injectable, Logger } from '@nestjs/common';
import { propagateAttributes, startActiveObservation } from '@langfuse/tracing';
import { ItinerariesService } from './itineraries.service';
import { LLM_PROVIDER } from './llm/llm-provider.interface';
import type {
  LlmMessage,
  LlmProvider,
  LlmToolResult,
} from './llm/llm-provider.interface';
import { PROMPT_INJECTION_RULES } from './llm/prompt-rules';
import { trimHistory, truncateToolResult } from './llm/conversation-history';
import { CONVERSATION_STORE } from './llm/conversation-store';
import type { ConversationStore } from './llm/conversation-store';
import { EXTERNAL_CACHE } from './external/external-cache';
import type { ExternalCache } from './external/external-cache';
import { createAgentTools } from './tools';
import type { ChatSource, GlobeFocus, ToolRegistry } from './tools';
import type { RunEventEmitter } from './runs/run-event-emitter';
import {
  emitToolResults,
  observedLlmCall,
  observedToolRun,
} from './runs/step-events';
import type { EmitRunEvent } from './runs/step-events';

export type { ChatSource } from './tools';

export interface ChatResult {
  reply: string;
  sources: ChatSource[];
  // true, sobald search_travel_knowledge mindestens einmal aufgerufen wurde -
  // unabhängig davon, ob es Treffer geliefert hat. Trennt "Frage brauchte
  // keine Wissensbasis" (z.B. Small Talk) von "Wissensbasis wurde befragt,
  // aber nichts Passendes gefunden" - im Frontend zwei unterschiedliche
  // UI-Botschaften (siehe apps/web).
  searchAttempted: boolean;
  // Reiseziel, zu dem der Globus im Chat dreht (aus show_destination_on_globe)
  focus?: GlobeFocus;
  // Stationen, die der Globus als verbundene Route zeigt: die Programmpunkte
  // eines gespeicherten Plans oder mehrere Ziele aus derselben Antwort
  route?: GlobeFocus[];
}

const SYSTEM_PROMPT = `Du bist ein Reiseplaner-Assistent. Du hilfst Nutzern dabei, einen Reiseplan zu erstellen, indem du im Dialog Ziel, Reisedaten, Budget und Präferenzen erfragst.

Nutze die verfügbaren Werkzeuge.
- show_destination_on_globe, sobald der Nutzer ein konkretes Reiseziel nennt: als allererstes Werkzeug, noch vor jeder Suche und in derselben Antwort, einmal pro Ziel (bei Rundreisen in Reihenfolge der Route), mit den Koordinaten des Ortszentrums. Kennst du den Abreiseort, gib ihn als origin mit; erfährst du ihn erst später, rufe das Werkzeug dann einmal erneut mit origin auf. Dieses Werkzeug braucht keine weiteren Angaben, rufe es also auch dann auf, wenn du noch Rückfragen stellst. Es läuft unsichtbar im Hintergrund: Erwähne den Globus oder die Markierung nie in deiner Antwort.
- search_travel_knowledge, um Faktenfragen zu einem Reiseziel (Sehenswürdigkeiten, Essen & Trinken, Transport) zu beantworten. Nutze es, BEVOR du aus dem Gedächtnis antwortest, und belege deine Aussage mit der zurückgegebenen Quelle (Titel + Quelle). Ordne einer Quelle nur zu, was tatsächlich in ihren Treffern steht. Ergänzt du etwas aus eigenem Wissen, trenne es sichtbar davon ab, z. B. in einem eigenen Abschnitt "Weitere Ideen (nicht aus der Wissensbasis)", statt es unter die Quellenangabe zu mischen. Liefert es keine passenden Treffer, sag das ehrlich, statt zu raten oder zu spekulieren. Bei Vergleichen oder mehreren Fragen rufe das Werkzeug für alle Ziele und Themen gleichzeitig in derselben Antwort auf, statt nacheinander, und höchstens einmal pro Ziel.
- estimate_transport für die Anreise (Bahn oder Flug), sobald du Abreiseort und Ziel kennst.
- search_lodging für Unterkünfte im Zentrum, sobald Ziel und Reisedaten feststehen (checkIn/checkOut, wenn bekannt auch budgetPerNightEur). Empfiehl nur Unterkünfte, die das Werkzeug geliefert hat, mit ihrem Namen. Für echte Preise und freie Zimmer verweise auf die Links aus searchLinks (Booking.com, Airbnb). Gib nur diese Links aus, erfinde keine eigenen.
- convert_currency, wenn Preise oder das Budget in einer anderen Währung als Euro vorliegen oder der Nutzer in einer anderen Währung rechnet.
Preise aus estimate_transport und search_lodging sind Schätzungen, keine Angebote: Nenne sie immer als ungefähre Spanne mit dem Zusatz "geschätzt" und erfinde keine genauen Preise, Verbindungen, Flugnummern oder freien Zimmer.
- save_itinerary, um den fertigen Plan zu speichern, sobald du gemeinsam mit dem Nutzer einen konkreten Tagesplan mit einzelnen Programmpunkten erarbeitet hast. Gib bei jedem Programmpunkt die ungefähren Koordinaten seines Orts an (lat, lng; bei Punkten ohne festen Ort die der Stadt), damit die ganze Route auf dem Globus erscheint.
- get_weather, sobald Ziel und Reisedaten feststehen, für den Reisezeitraum. Plane Tage mit Regen oder Gewitter mit Indoor-Programm (Museen, Märkte, Cafés). Stammen die Werte aus dem Vorjahr (source "climate"), sag das dazu, statt sie als Vorhersage auszugeben.

${PROMPT_INJECTION_RULES}

Formatiere Antworten in Markdown (fett, Listen, Tabellen). Verwende niemals HTML-Tags, auch kein <br>. Braucht eine Tabellenzelle mehrere Punkte, trenne sie mit Kommas oder nutze statt der Tabelle eine Liste.

Frag aktiv nach fehlenden Informationen, bevor du ein Werkzeug aufrufst (Ausnahme: show_destination_on_globe). Antworte immer auf Deutsch.`;

// Das Modell kennt das heutige Datum nicht. Ohne diese Zeile las es
// "10. Oktober" als Oktober des Jahres aus seinem Training, das Wetter-Tool
// meldete "liegt in der Vergangenheit", und statt eines Plans kam eine
// verwirrte Rückfrage. Deshalb kommt das Datum bei jedem Aufruf mit.
export function systemPrompt(today: string): string {
  return `${SYSTEM_PROMPT}

Heute ist ${today}. Reisedaten ohne Jahresangabe meinen immer das nächste Mal, an dem dieses Datum noch bevorsteht; setze in Werkzeugaufrufen das passende Jahr ein (Format YYYY-MM-DD) und frag deswegen nicht nach. Widersprechen sich Angaben (z. B. "3 Tage" und ein Zeitraum von einer Woche), nimm den genannten Zeitraum und sag das kurz dazu. Nenne in deiner Antwort nie die Namen der Werkzeuge.`;
}

const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS ?? 4096);
const MAX_HISTORY_MESSAGES = Number(process.env.LLM_MAX_HISTORY_MESSAGES ?? 20);
const MAX_TOOL_RESULT_CHARS = Number(
  process.env.LLM_MAX_TOOL_RESULT_CHARS ?? 2000,
);
// Obergrenze für Tool-Runden pro Nachricht: Ohne sie könnte ein Modell (oder
// eine manipulierte Eingabe) die Schleife unbegrenzt weiterlaufen lassen, und
// jede Runde ist ein bezahlter LLM-Aufruf. 8 statt 5: Groq (gpt-oss) ruft
// die Tools meist einzeln nacheinander auf statt gebündelt in einer Runde -
// bei einer vollständigen Reiseplanung (Wissen, Anreise, Unterkünfte, Globus, ...)
// fiel sonst genau der abschließende save_itinerary-Aufruf dem Limit zum Opfer.
export const MAX_TOOL_ITERATIONS = Number(
  process.env.LLM_MAX_TOOL_ITERATIONS ?? 8,
);
const TOOL_LIMIT_REPLY =
  'Das war mir gerade zu viel auf einmal. Kannst du deine Anfrage etwas eingrenzen?';

// Für den Vergleich von Titel und Antworttext: Anführungszeichen weg,
// Binde-/Gedankenstriche vereinheitlicht, damit "Wien – Reiseziel-Überblick"
// auch als „Wien-Reiseziel-Überblick“ in der Antwort erkannt wird.
function normalizeForCitation(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'„“”‚‘’«»]/g, '')
    .replace(/\s*[-‐‑‒–—]\s*/g, '-')
    .replace(/\s+/g, ' ');
}

// Die Suche liefert die Top-k-Treffer unabhängig vom Reiseziel, bei einer
// Wien-Frage also z. B. auch das Berlin-Dokument auf Platz 3. Angezeigt
// werden deshalb nur die Quellen, die die Antwort selbst nennt (der
// SYSTEM_PROMPT verlangt Titel + Quelle). Nennt sie keine, bleiben alle
// Treffer stehen: lieber eine Quelle zu viel als eine belegte Antwort ganz
// ohne Quellenangabe.
export function citedSources(
  sources: ChatSource[],
  reply: string,
): ChatSource[] {
  const normalizedReply = normalizeForCitation(reply);
  const cited = sources.filter((source) =>
    normalizedReply.includes(normalizeForCitation(source.title)),
  );
  return cited.length > 0 ? cited : sources;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly tools: ToolRegistry;

  // "Heute" als YYYY-MM-DD (UTC), in Tests überschreibbar
  today = () => new Date().toISOString().slice(0, 10);

  constructor(
    itinerariesService: ItinerariesService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(CONVERSATION_STORE)
    private readonly conversationStore: ConversationStore,
    @Inject(EXTERNAL_CACHE) externalCache: ExternalCache,
  ) {
    this.tools = createAgentTools(itinerariesService, externalCache);
  }

  // `events` ist optional: POST /agent/runs übergibt einen Emitter und
  // streamt jeden Schritt live ans Frontend, POST /agent/chat (Evals, MCP,
  // ältere Clients) läuft ohne und bekommt nur das Endergebnis.
  async sendMessage(
    userId: string,
    sessionId: string,
    userMessage: string,
    events?: RunEventEmitter,
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
        // Verlauf pro Nutzer UND Session: die sessionId kommt vom Client,
        // allein wäre sie erratbar, und man könnte fremde Verläufe fortsetzen.
        // Liegt in der Datenbank statt im Arbeitsspeicher, damit jede Instanz
        // (und jede nach einem Neustart) denselben Stand sieht.
        const history = await this.conversationStore.load(userId, sessionId);
        const emit: EmitRunEvent | undefined =
          events && ((type, data) => events.emit(type, data));
        history.push({ role: 'user', content: userMessage });

        let result = await this.callLlm(history, emit);
        const sources = new Map<string, ChatSource>();
        let searchAttempted = false;
        const destinations: GlobeFocus[] = [];
        let savedRoute: GlobeFocus[] | undefined;
        let toolIterations = 0;

        while (result.finishReason === 'tool_calls') {
          if (toolIterations >= MAX_TOOL_ITERATIONS) {
            this.logger.warn(
              `Tool-Limit (${MAX_TOOL_ITERATIONS} Runden) erreicht, Schleife abgebrochen`,
            );
            result = { ...result, content: TOOL_LIMIT_REPLY };
            break;
          }
          toolIterations++;

          history.push({
            role: 'assistant',
            content: result.content ?? undefined,
            toolCalls: result.toolCalls,
          });

          // Alle Tool-Aufrufe einer Runde gleichzeitig starten: die Wartezeit
          // ist dann die des langsamsten Tools statt der Summe aller. Die
          // Auswertung danach bleibt in der Reihenfolge der Aufrufe.
          const runs = await Promise.all(
            result.toolCalls.map((call) =>
              observedToolRun(
                this.tools,
                call.name,
                call.arguments,
                userId,
                emit,
              ),
            ),
          );
          const toolResults: LlmToolResult[] = [];
          for (const [index, call] of result.toolCalls.entries()) {
            const run = runs[index];
            if (run.retrieval) {
              searchAttempted = true;
              this.collectSources(run.sources, sources);
            }
            // Dasselbe Ziel zweimal hintereinander ergäbe keinen Bogen
            if (run.focus && run.focus.name !== destinations.at(-1)?.name) {
              destinations.push(run.focus);
            }
            if (run.route) {
              savedRoute = run.route;
            }
            // Globus, Wetter-Chips und Unterkünfte sofort, während das
            // Modell noch am Plan schreibt
            emitToolResults(run, emit);
            toolResults.push({
              toolCallId: call.id,
              content: truncateToolResult(
                JSON.stringify(run.output),
                MAX_TOOL_RESULT_CHARS,
              ),
            });
          }
          history.push({ role: 'tool', toolResults });

          result = await this.callLlm(history, emit);
        }

        history.push({ role: 'assistant', content: result.content ?? '' });
        await this.conversationStore.save(userId, sessionId, history);
        turn.update({
          metadata: { searchAttempted, sourceCount: sources.size },
        });
        const reply = result.content ?? '';
        // Ein gespeicherter Plan zeigt seine Stationen. Sonst werden mehrere
        // Ziele aus derselben Antwort (Rundreise) in Nennungsreihenfolge
        // verbunden.
        const route =
          savedRoute ?? (destinations.length > 1 ? destinations : undefined);
        return {
          reply,
          sources: citedSources(
            [...sources.values()].sort((a, b) => b.score - a.score),
            reply,
          ),
          searchAttempted,
          focus: destinations.at(-1),
          route,
        };
      }),
    );
  }

  private collectSources(
    hits: ChatSource[],
    sources: Map<string, ChatSource>,
  ): void {
    for (const hit of hits) {
      // Pro Dokument nur einen Eintrag: verschiedene Chunks desselben
      // Dokuments haben unterschiedliche Scores, die Quellenliste im Frontend
      // soll jedes Dokument aber nur einmal zeigen, mit dem besten Treffer.
      const existing = sources.get(hit.title);
      if (!existing || hit.score > existing.score) {
        sources.set(hit.title, hit);
      }
    }
  }

  private callLlm(history: LlmMessage[], emit?: EmitRunEvent) {
    const messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt(this.today()) },
      ...trimHistory(history, MAX_HISTORY_MESSAGES),
    ];
    return observedLlmCall(
      this.llm,
      messages,
      this.tools.definitions(),
      MAX_TOKENS,
      emit,
    );
  }
}
