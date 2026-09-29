import {
  AgentService,
  MAX_TOOL_ITERATIONS,
  citedSources,
  systemPrompt,
} from './agent.service';
import type { ChatSource } from './agent.service';
import { searchTravelKnowledge } from './rag-client';
import { InMemoryExternalCache } from './external/external-cache';
import { addDays } from './external/open-meteo.client';
import type { ItinerariesService } from './itineraries.service';
import type { ConversationStore } from './llm/conversation-store';
import type {
  LlmChatOptions,
  LlmChatResult,
  LlmMessage,
} from './llm/llm-provider.interface';
import { RunEventEmitter } from './runs/run-event-emitter';
import type { RunEvent } from './runs/run-events';

jest.mock('./rag-client', () => ({ searchTravelKnowledge: jest.fn() }));

function hit(title: string, score: number) {
  return {
    content: `Inhalt aus ${title}`,
    title,
    source: 'Eigene Recherche',
    license: 'Eigene Inhalte',
    url: null,
    score,
  };
}

function source(title: string, score: number): ChatSource {
  return {
    title,
    source: 'Eigene Recherche',
    license: 'Eigene Inhalte',
    url: null,
    score,
  };
}

function toolCallResult(
  name: string,
  args: Record<string, unknown>,
): LlmChatResult {
  return {
    content: null,
    toolCalls: [{ id: `call-${name}`, name, arguments: args }],
    finishReason: 'tool_calls',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'fake',
  };
}

function textResult(content: string): LlmChatResult {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'fake',
  };
}

describe('AgentService', () => {
  let llm: { chat: jest.Mock };
  let itineraries: { create: jest.Mock };
  let agent: AgentService;
  let stored: Map<string, LlmMessage[]>;
  let externalCache: InMemoryExternalCache;

  beforeEach(() => {
    // Speicher im Arbeitsspeicher statt Prisma, wie ConversationStore es verlangt
    stored = new Map();
    const store: ConversationStore = {
      load: (u, s) =>
        Promise.resolve(structuredClone(stored.get(`${u}:${s}`) ?? [])),
      save: (u, s, m) => {
        stored.set(`${u}:${s}`, structuredClone(m));
        return Promise.resolve();
      },
    };
    llm = { chat: jest.fn() };
    itineraries = { create: jest.fn().mockResolvedValue({ id: 'plan-1' }) };
    externalCache = new InMemoryExternalCache();
    agent = new AgentService(
      itineraries as unknown as ItinerariesService,
      llm,
      store,
      externalCache,
    );
  });

  it(`bricht die Tool-Schleife nach ${MAX_TOOL_ITERATIONS} Runden ab`, async () => {
    // Ein Modell, das nie aufhört, Tools aufzurufen
    llm.chat.mockResolvedValue(toolCallResult('search_lodging', { place: '' }));

    const result = await agent.sendMessage('user-a', 'session-1', 'Hallo');

    // 1 erster Aufruf + MAX_TOOL_ITERATIONS Folgeaufrufe, dann Schluss
    expect(llm.chat).toHaveBeenCalledTimes(MAX_TOOL_ITERATIONS + 1);
    expect(result.reply).toMatch(/eingrenzen/);
  });

  it('speichert Pläne aus dem Chat unter dem anfragenden Nutzer', async () => {
    const plan = {
      destination: 'Wien',
      startDate: '2026-09-01',
      endDate: '2026-09-04',
      budgetCents: 50000,
      stops: [],
    };
    llm.chat
      .mockResolvedValueOnce(toolCallResult('save_itinerary', plan))
      .mockResolvedValueOnce(textResult('Gespeichert!'));

    await agent.sendMessage('user-a', 'session-1', 'Speicher das');

    expect(itineraries.create).toHaveBeenCalledWith('user-a', plan);
  });

  it('liefert die Stationen eines gespeicherten Plans als Route', async () => {
    const plan = {
      destination: 'Portugal',
      startDate: '2026-09-01',
      endDate: '2026-09-04',
      budgetCents: 50000,
      stops: [
        {
          dayNumber: 2,
          order: 1,
          title: 'Porto',
          category: 'CULTURE',
          lat: 41.15,
          lng: -8.61,
        },
        {
          dayNumber: 1,
          order: 1,
          title: 'Lissabon',
          category: 'CULTURE',
          lat: 38.72,
          lng: -9.14,
        },
        { dayNumber: 1, order: 2, title: 'Freizeit', category: 'OTHER' },
      ],
    };
    llm.chat
      .mockResolvedValueOnce(toolCallResult('save_itinerary', plan))
      .mockResolvedValueOnce(textResult('Gespeichert!'));

    const result = await agent.sendMessage('user-a', 'session-1', 'Speicher');

    expect(result.route).toEqual([
      { name: 'Lissabon', lat: 38.72, lng: -9.14 },
      { name: 'Porto', lat: 41.15, lng: -8.61 },
    ]);
  });

  it('verbindet mehrere Ziele aus einer Antwort zu einer Route', async () => {
    llm.chat
      .mockResolvedValueOnce({
        ...toolCallResult('show_destination_on_globe', {}),
        toolCalls: [
          {
            id: 'c1',
            name: 'show_destination_on_globe',
            arguments: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
          },
          {
            id: 'c2',
            name: 'show_destination_on_globe',
            arguments: { name: 'Porto', lat: 41.15, lng: -8.61 },
          },
        ],
      })
      .mockResolvedValueOnce(textResult('Schöne Route!'));

    const result = await agent.sendMessage('user-a', 'session-1', 'Rundreise');

    expect(result.focus).toEqual({ name: 'Porto', lat: 41.15, lng: -8.61 });
    expect(result.route?.map((stop) => stop.name)).toEqual([
      'Lissabon',
      'Porto',
    ]);
  });

  it('liefert bei nur einem Ziel keine Route', async () => {
    llm.chat
      .mockResolvedValueOnce(
        toolCallResult('show_destination_on_globe', {
          name: 'Wien',
          lat: 48.2,
          lng: 16.37,
        }),
      )
      .mockResolvedValueOnce(textResult('Wien!'));

    const result = await agent.sendMessage('user-a', 'session-1', 'Wien');

    expect(result.focus?.name).toBe('Wien');
    expect(result.route).toBeUndefined();
  });

  it('gibt einen ungültigen Plan als Tool-Fehler an das Modell zurück', async () => {
    const invalid = {
      destination: 'Wien',
      startDate: 'quatsch',
      endDate: '2026-09-04',
      budgetCents: 50000,
      stops: [],
    };
    llm.chat
      .mockResolvedValueOnce(toolCallResult('save_itinerary', invalid))
      .mockResolvedValueOnce(textResult('Ich korrigiere das Datum.'));

    const result = await agent.sendMessage('user-a', 'session-1', 'Speicher');

    expect(itineraries.create).not.toHaveBeenCalled();
    // Das Modell bekommt die Fehlermeldung als Tool-Ergebnis zu sehen
    const calls = llm.chat.mock.calls as [LlmMessage[]][];
    const toolMessage = calls[1][0].find((m) => m.role === 'tool');
    expect(toolMessage?.toolResults?.[0].content).toContain('startDate');
    expect(result.reply).toBe('Ich korrigiere das Datum.');
  });

  it('schickt dem Modell das heutige Datum im System-Prompt mit', async () => {
    llm.chat.mockResolvedValue(textResult('ok'));
    agent.today = () => '2026-09-29';

    await agent.sendMessage('user-a', 'session-1', 'Lissabon ab 10. Oktober');

    const calls = llm.chat.mock.calls as [LlmMessage[]][];
    expect(calls[0][0][0]).toMatchObject({ role: 'system' });
    expect(calls[0][0][0].content).toContain('Heute ist 2026-09-29');
  });

  it('trennt Chat-Verläufe verschiedener Nutzer mit gleicher sessionId', async () => {
    llm.chat.mockResolvedValue(textResult('ok'));

    await agent.sendMessage('user-a', 'gleiche-session', 'Geheimnis von A');
    await agent.sendMessage('user-b', 'gleiche-session', 'Hallo');

    const calls = llm.chat.mock.calls as [LlmMessage[]][];
    const messagesForB = calls[1][0];
    expect(messagesForB.some((m) => m.content === 'Geheimnis von A')).toBe(
      false,
    );
  });

  it('setzt eine Unterhaltung mit dem gespeicherten Verlauf fort', async () => {
    llm.chat.mockResolvedValue(textResult('ok'));

    await agent.sendMessage('user-a', 'session-1', 'Ich will nach Wien');
    // Eine neue Instanz (z. B. zweite Replica oder nach Neustart) mit demselben Speicher
    const store = (agent as unknown as { conversationStore: ConversationStore })
      .conversationStore;
    const secondInstance = new AgentService(
      itineraries as unknown as ItinerariesService,
      llm,
      store,
      externalCache,
    );
    await secondInstance.sendMessage('user-a', 'session-1', 'Im September');

    const calls = llm.chat.mock.calls as [LlmMessage[]][];
    const contents = calls[1][0].map((m) => m.content);
    expect(contents).toContain('Ich will nach Wien');
    expect(stored.get('user-a:session-1')).toHaveLength(4);
  });

  it('meldet jeden Schritt als Ereignis, Globus-Updates vor der Antwort', async () => {
    llm.chat
      .mockResolvedValueOnce(
        toolCallResult('show_destination_on_globe', {
          name: 'Lissabon',
          lat: 38.72,
          lng: -9.14,
          origin: { name: 'Berlin', lat: 52.52, lng: 13.4 },
        }),
      )
      .mockResolvedValueOnce(textResult('Los geht es!'));
    const received: RunEvent[] = [];

    await agent.sendMessage(
      'user-a',
      'session-1',
      '3 Tage Lissabon ab Berlin',
      new RunEventEmitter((event) => received.push(event)),
    );

    expect(received.map((event) => event.type)).toEqual([
      'llm.started',
      'llm.call',
      'tool.started',
      'tool.finished',
      'place.added',
      'route.added',
      'place.added',
      'llm.started',
      'llm.call',
    ]);
    const route = received.find((event) => event.type === 'route.added');
    expect(route?.data).toEqual({
      from: { name: 'Berlin', lat: 52.52, lng: 13.4 },
      to: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
    });
    const toolDone = received.find((event) => event.type === 'tool.finished');
    expect(toolDone?.data).toMatchObject({
      tool: 'show_destination_on_globe',
      ok: true,
    });
  });

  it('meldet eine Wartezeit des Rate-Limiters als llm.throttled am laufenden Schritt', async () => {
    // Der Provider (hier gefälscht) meldet vor dem Aufruf, dass er wartet
    llm.chat.mockImplementation(
      (_messages: unknown, _tools: unknown, options: LlmChatOptions) => {
        options.onThrottle?.(6000, 'tokens');
        return Promise.resolve(textResult('Fertig'));
      },
    );
    const received: RunEvent[] = [];

    await agent.sendMessage(
      'user-a',
      'session-1',
      'Hallo',
      new RunEventEmitter((event) => received.push(event)),
    );

    expect(received.map((event) => event.type)).toEqual([
      'llm.started',
      'llm.throttled',
      'llm.call',
    ]);
    const started = received[0];
    expect(received[1].data).toEqual({
      stepId: (started.data as { stepId: string }).stepId,
      waitMs: 6000,
      reason: 'tokens',
    });
  });

  describe('get_weather', () => {
    const originalFetch = global.fetch;
    // Relativ zu heute, damit der Test nicht mit dem Kalender altert
    const today = new Date().toISOString().slice(0, 10);
    const startDate = addDays(today, 2);
    const endDate = addDays(today, 3);
    let fetchMock: jest.Mock;

    beforeEach(() => {
      // Open-Meteo gemockt: Geokodierung und Tageswerte nach URL
      fetchMock = jest.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url.includes('geocoding-api')
                ? {
                    results: [
                      { name: 'Lissabon', latitude: 38.72, longitude: -9.14 },
                    ],
                  }
                : {
                    daily: {
                      time: [startDate, endDate],
                      weather_code: [0, 63],
                      temperature_2m_max: [24, 19],
                      temperature_2m_min: [16, 14],
                      precipitation_sum: [0, 12.5],
                    },
                  },
            ),
        }),
      );
      global.fetch = fetchMock;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    const weatherCall = () =>
      toolCallResult('get_weather', {
        place: 'Lissabon',
        startDate,
        endDate,
      });

    it('meldet das Wetter direkt nach dem Tool, vor dem nächsten LLM-Aufruf', async () => {
      llm.chat
        .mockResolvedValueOnce(weatherCall())
        .mockResolvedValueOnce(textResult('Tag 2 wird nass.'));
      const received: RunEvent[] = [];

      await agent.sendMessage(
        'user-a',
        'session-1',
        'Wetter in Lissabon?',
        new RunEventEmitter((event) => received.push(event)),
      );

      expect(received.map((event) => event.type)).toEqual([
        'llm.started',
        'llm.call',
        'tool.started',
        'tool.finished',
        'weather.updated',
        'llm.started',
        'llm.call',
      ]);
      const weather = received.find(
        (event) => event.type === 'weather.updated',
      );
      expect(weather?.data).toMatchObject({
        place: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
        source: 'forecast',
        days: [
          { date: startDate, tMax: 24, precipMm: 0, label: 'Klar' },
          { date: endDate, tMax: 19, precipMm: 12.5, label: 'Regen' },
        ],
      });
      const toolDone = received.find((event) => event.type === 'tool.finished');
      expect(toolDone?.data).toMatchObject({ ok: true, cached: false });
    });

    it('beantwortet einen zweiten gleichen Aufruf aus dem Cache', async () => {
      llm.chat
        .mockResolvedValueOnce(weatherCall())
        .mockResolvedValueOnce(textResult('ok'))
        .mockResolvedValueOnce(weatherCall())
        .mockResolvedValueOnce(textResult('ok'));
      const received: RunEvent[] = [];
      const emitter = () =>
        new RunEventEmitter((event) => received.push(event));

      await agent.sendMessage('user-a', 'session-1', 'Wetter?', emitter());
      await agent.sendMessage('user-a', 'session-1', 'Nochmal', emitter());

      // Geokodierung + Vorhersage je einmal, der zweite Lauf kommt ohne Netz aus
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const finished = received.filter(
        (event) => event.type === 'tool.finished',
      );
      expect(finished.map((event) => event.data)).toEqual([
        expect.objectContaining({ cached: false }),
        expect.objectContaining({ cached: true }),
      ]);
    });

    it('meldet bei ausgefallenem Open-Meteo kein Wetter, aber einen Tool-Fehler', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      llm.chat
        .mockResolvedValueOnce(weatherCall())
        .mockResolvedValueOnce(textResult('Wetter gerade nicht verfügbar.'));
      const received: RunEvent[] = [];

      const result = await agent.sendMessage(
        'user-a',
        'session-1',
        'Wetter?',
        new RunEventEmitter((event) => received.push(event)),
      );

      expect(result.reply).toBe('Wetter gerade nicht verfügbar.');
      expect(received.some((event) => event.type === 'weather.updated')).toBe(
        false,
      );
      const toolDone = received.find((event) => event.type === 'tool.finished');
      expect(toolDone?.data).toMatchObject({ ok: false });
    });
  });

  describe('search_lodging und estimate_transport', () => {
    const originalFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
      // Open-Meteo (Geokodierung) und Overpass gemockt, nach URL
      fetchMock = jest.fn((url: string) => {
        const place = url.includes('name=Berlin')
          ? { name: 'Berlin', latitude: 52.52, longitude: 13.41 }
          : { name: 'Wien', latitude: 48.21, longitude: 16.37 };
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve(
              url.includes('geocoding-api')
                ? { results: [place] }
                : {
                    elements: [
                      {
                        type: 'node',
                        lat: 48.2039,
                        lon: 16.3699,
                        tags: { tourism: 'hotel', name: 'Hotel Sacher' },
                      },
                    ],
                  },
            ),
        });
      });
      global.fetch = fetchMock;
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('meldet Unterkünfte direkt nach dem Tool, vor dem nächsten LLM-Aufruf', async () => {
      llm.chat
        .mockResolvedValueOnce(
          toolCallResult('search_lodging', { place: 'Wien' }),
        )
        .mockResolvedValueOnce(textResult('Hotel Sacher, ca. 90–170 €.'));
      const received: RunEvent[] = [];

      await agent.sendMessage(
        'user-a',
        'session-1',
        'Hotels in Wien?',
        new RunEventEmitter((event) => received.push(event)),
      );

      expect(received.map((event) => event.type)).toEqual([
        'llm.started',
        'llm.call',
        'tool.started',
        'tool.finished',
        'lodging.updated',
        'llm.started',
        'llm.call',
      ]);
      const lodging = received.find(
        (event) => event.type === 'lodging.updated',
      );
      expect(lodging?.data).toEqual({
        place: { name: 'Wien', lat: 48.21, lng: 16.37 },
        searchLinks: {
          booking:
            'https://www.booking.com/searchresults.html?ss=Wien&group_adults=2&no_rooms=1',
          airbnb: 'https://www.airbnb.de/s/Wien/homes?adults=2',
        },
        items: [
          {
            name: 'Hotel Sacher',
            lat: 48.2039,
            lng: 16.3699,
            kind: 'hotel',
            priceMinEur: 90,
            priceMaxEur: 170,
          },
        ],
      });
      // Das Modell bekommt die Schätzung als solche markiert
      const toolMessage = (llm.chat.mock.calls[1] as [LlmMessage[]])[0].at(-1);
      expect(toolMessage?.toolResults?.[0].content).toContain(
        '"estimate":true',
      );
    });

    it('zeichnet für die Anreise-Schätzung einen Bogen auf dem Globus', async () => {
      llm.chat
        .mockResolvedValueOnce(
          toolCallResult('estimate_transport', {
            origin: 'Berlin',
            destination: 'Wien',
          }),
        )
        .mockResolvedValueOnce(textResult('Mit der Bahn ca. 40–120 €.'));
      const received: RunEvent[] = [];

      await agent.sendMessage(
        'user-a',
        'session-1',
        'Wie komme ich von Berlin nach Wien?',
        new RunEventEmitter((event) => received.push(event)),
      );

      const route = received.find((event) => event.type === 'route.added');
      expect(route?.data).toEqual({
        from: { name: 'Berlin', lat: 52.52, lng: 13.41 },
        to: { name: 'Wien', lat: 48.21, lng: 16.37 },
      });
      expect(received.some((event) => event.type === 'lodging.updated')).toBe(
        false,
      );
    });
  });

  it('zeigt nur die Quellen, die die Antwort nennt', async () => {
    jest.mocked(searchTravelKnowledge).mockResolvedValue({
      available: true,
      results: [
        hit('Wien – Reiseziel-Überblick', 0.71),
        hit('Berlin – Reiseziel-Überblick', 0.64),
      ],
    });
    llm.chat
      .mockResolvedValueOnce(
        toolCallResult('search_travel_knowledge', { query: 'Essen in Wien' }),
      )
      .mockResolvedValueOnce(
        textResult('Tafelspitz. *Quelle: „Wien – Reiseziel-Überblick“*'),
      );

    const result = await agent.sendMessage('user-a', 'session-1', 'Essen?');

    expect(result.sources.map((s) => s.title)).toEqual([
      'Wien – Reiseziel-Überblick',
    ]);
    expect(result.searchAttempted).toBe(true);
  });
});

describe('citedSources', () => {
  const wien = source('Wien – Reiseziel-Überblick', 0.71);
  const berlin = source('Berlin – Reiseziel-Überblick', 0.64);

  it('erkennt den Titel auch mit anderen Strichen und Anführungszeichen', () => {
    expect(
      citedSources([wien, berlin], 'Quelle: "Wien-Reiseziel-Überblick"'),
    ).toEqual([wien]);
  });

  it('behält bei einem Vergleich alle genannten Quellen', () => {
    const reply =
      'Laut Wien – Reiseziel-Überblick … und laut Berlin – Reiseziel-Überblick …';
    expect(citedSources([wien, berlin], reply)).toEqual([wien, berlin]);
  });

  it('lässt alle Treffer stehen, wenn die Antwort keine Quelle nennt', () => {
    expect(citedSources([wien, berlin], 'Schnitzel und Tafelspitz.')).toEqual([
      wien,
      berlin,
    ]);
  });
});

describe('systemPrompt', () => {
  it('nennt das heutige Datum und verbietet Werkzeugnamen in der Antwort', () => {
    const prompt = systemPrompt('2026-09-29');
    expect(prompt).toContain('Heute ist 2026-09-29');
    expect(prompt).toContain('nie die Namen der Werkzeuge');
  });

  it('plant sofort und verbietet erfundene Anbieter, Zeiten und Preise', () => {
    const prompt = systemPrompt('2026-09-29');
    expect(prompt).toContain(
      'Sobald Ziel und Reisezeitraum bekannt sind, planst du sofort',
    );
    expect(prompt).toContain(
      'Erfundene Anbieter, Namen, Zeiten oder Preise sind nicht erlaubt',
    );
    expect(prompt).not.toContain('bevor du ein Werkzeug aufrufst');
  });
});
