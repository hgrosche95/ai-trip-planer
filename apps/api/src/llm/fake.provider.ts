import type {
  LlmChatResult,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
} from './llm-provider.interface';

// Ziele, die der Fake erkennt. Alles andere wird zu Wien, damit eine
// Planungsanfrage immer zu einem gespeicherten Plan führt.
const DESTINATIONS = [
  { name: 'Wien', lat: 48.21, lng: 16.37 },
  { name: 'Lissabon', lat: 38.72, lng: -9.14 },
  { name: 'Berlin', lat: 52.52, lng: 13.4 },
  { name: 'Rom', lat: 41.9, lng: 12.5 },
];

const PLAN_REQUEST = /plane|speicher/i;

// Deterministischer LLM-Ersatz (LLM_PROVIDER=fake) für E2E-Tests in CI und
// lokales Arbeiten an der Oberfläche: kein API-Key, keine Tokens, kein
// Rate-Limit. Er spielt den Agenten-Ablauf mit echten Tool-Aufrufen nach
// (Wissenssuche, Globus, Speichern), damit API, Datenbank, RAG-Service und
// Frontend wie im Betrieb durchlaufen. Wie gut das echte Modell plant, prüft
// stattdessen der nächtliche Eval-Lauf.
export class FakeLlmProvider implements LlmProvider {
  chat(messages: LlmMessage[]): Promise<LlmChatResult> {
    const last = messages.at(-1);
    if (last?.role === 'tool') {
      return Promise.resolve(text(replyToToolResults(messages)));
    }
    const userText = last?.content ?? '';
    if (PLAN_REQUEST.test(userText)) {
      return Promise.resolve(toolCalls(planCalls(userText)));
    }
    return Promise.resolve(
      toolCalls([
        {
          id: 'fake-search',
          name: 'search_travel_knowledge',
          arguments: { query: userText },
        },
      ]),
    );
  }
}

function planCalls(userText: string): LlmToolCall[] {
  const destination =
    DESTINATIONS.find((d) =>
      userText.toLowerCase().includes(d.name.toLowerCase()),
    ) ?? DESTINATIONS[0];
  const start = new Date();
  start.setDate(start.getDate() + 30);
  const end = new Date(start);
  end.setDate(end.getDate() + 2);
  const { name, lat, lng } = destination;
  return [
    {
      id: 'fake-globe',
      name: 'show_destination_on_globe',
      arguments: { name, lat, lng },
    },
    {
      id: 'fake-save',
      name: 'save_itinerary',
      arguments: {
        destination: name,
        startDate: isoDate(start),
        endDate: isoDate(end),
        budgetCents: 50_000,
        currency: 'EUR',
        stops: [
          {
            dayNumber: 1,
            order: 1,
            title: `Ankunft in ${name}`,
            category: 'TRANSPORT',
            lat,
            lng,
          },
          {
            dayNumber: 1,
            order: 2,
            title: 'Altstadtrundgang',
            category: 'SIGHTSEEING',
            costCents: 0,
            lat: lat + 0.01,
            lng,
          },
          {
            dayNumber: 2,
            order: 1,
            title: 'Museum',
            category: 'CULTURE',
            costCents: 2_000,
            lat,
            lng: lng + 0.01,
          },
          { dayNumber: 3, order: 1, title: 'Abreise', category: 'TRANSPORT' },
        ],
      },
    },
  ];
}

function replyToToolResults(messages: LlmMessage[]): string {
  const results = messages.at(-1)?.toolResults ?? [];
  const calls = messages.at(-2)?.toolCalls ?? [];
  const nameOf = (id: string) => calls.find((call) => call.id === id)?.name;

  for (const result of results) {
    const tool = nameOf(result.toolCallId);
    if (tool === 'save_itinerary') {
      return result.content.includes('"saved":true')
        ? 'Dein Reiseplan ist gespeichert. Du findest ihn unter „Meine Reisen“.'
        : `Speichern hat nicht geklappt: ${result.content}`;
    }
    if (tool === 'search_travel_knowledge') {
      // Tool-Ergebnisse sind gekürzt und damit nicht immer gültiges JSON,
      // die Titel stehen aber vorne.
      const titles = [...result.content.matchAll(/"title":"([^"]+)"/g)].map(
        (match) => match[1],
      );
      const unique = [...new Set(titles)];
      return unique.length > 0
        ? `Laut ${unique.map((title) => `**${title}**`).join(' und ')} gibt es dazu Folgendes in der Wissensbasis.`
        : 'Dazu habe ich in der Wissensbasis nichts gefunden.';
    }
  }
  return 'Erledigt.';
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function text(content: string): LlmChatResult {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'fake',
  };
}

function toolCalls(calls: LlmToolCall[]): LlmChatResult {
  return {
    content: null,
    toolCalls: calls,
    finishReason: 'tool_calls',
    usage: { inputTokens: 0, outputTokens: 0 },
    model: 'fake',
  };
}
