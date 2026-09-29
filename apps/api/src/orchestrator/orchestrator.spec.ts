import { ValidationPipe } from '@nestjs/common';
import { CreateItineraryDto } from '../itinerary.dto';
import type { ConversationStore } from '../llm/conversation-store';
import type { LlmChatResult, LlmMessage } from '../llm/llm-provider.interface';
import { RunEventEmitter } from '../runs/run-event-emitter';
import type { RunEvent, RunEventPayloads } from '../runs/run-events';
import { BudgetAgent } from './agents/budget.agent';
import { CriticAgent } from './agents/critic.agent';
import { PlannerAgent } from './agents/planner.agent';
import { ResearchAgent } from './agents/research.agent';
import { Orchestrator } from './orchestrator';
import { TODAY, researchTools } from './testing.fixtures';
import { InMemoryTripDraftStore } from './trip-draft-store';
import { searchTravelKnowledge } from '../rag-client';

jest.mock('../rag-client', () => ({ searchTravelKnowledge: jest.fn() }));

function reply(content: string, inputTokens: number, outputTokens: number) {
  return {
    content,
    toolCalls: [],
    finishReason: 'stop',
    usage: { inputTokens, outputTokens },
    model: 'openai/gpt-oss-120b',
  } satisfies LlmChatResult;
}

const TRIAGE = JSON.stringify({
  status: 'ready',
  destination: 'Lissabon',
  origin: 'Berlin',
  startDate: '2026-10-14',
  endDate: '2026-10-16',
  datesAssumed: true,
  travelers: 1,
  budget: { amount: 800, currency: 'EUR' },
  preferences: [],
  assumptions: ['1 Person', 'Unterkunft: Mittelklasse'],
});

const COMPOSE = JSON.stringify({
  stops: [
    {
      dayNumber: 1,
      order: 1,
      title: 'Ankunft',
      category: 'TRANSPORT',
      costCents: 0,
      lat: 38.77,
      lng: -9.13,
    },
    {
      dayNumber: 1,
      order: 2,
      title: 'Alfama und Tram 28',
      category: 'SIGHTSEEING',
      costCents: 300,
      lat: 38.71,
      lng: -9.13,
    },
    {
      dayNumber: 2,
      order: 1,
      title: 'Museu Nacional do Azulejo',
      category: 'CULTURE',
      costCents: 800,
      lat: 38.72,
      lng: -9.11,
    },
    {
      dayNumber: 2,
      order: 2,
      title: 'Time Out Market',
      category: 'FOOD',
      lat: 38.71,
      lng: -9.15,
    },
    {
      dayNumber: 3,
      order: 1,
      title: 'Belém',
      category: 'SIGHTSEEING',
      costCents: 1000,
      lat: 38.7,
      lng: -9.21,
    },
    {
      dayNumber: 3,
      order: 2,
      title: 'Abreise',
      category: 'TRANSPORT',
      lat: 38.77,
      lng: -9.13,
    },
  ],
});

// Derselbe Plan in Porto: Mit den Koordinaten aus Lissabon meldet der
// Kritiker zu Recht far-away
const COMPOSE_PORTO = JSON.stringify({
  stops: (
    JSON.parse(COMPOSE) as { stops: { lat: number; lng: number }[] }
  ).stops.map((stop) => ({
    ...stop,
    lat: stop.lat + 2.43,
    lng: stop.lng + 0.53,
  })),
});

function setup() {
  const stored = new Map<string, LlmMessage[]>();
  const store: ConversationStore = {
    load: (u, s) =>
      Promise.resolve(structuredClone(stored.get(`${u}:${s}`) ?? [])),
    save: (u, s, m) => {
      stored.set(`${u}:${s}`, structuredClone(m));
      return Promise.resolve();
    },
  };
  const llm = {
    chat: jest.fn<Promise<LlmChatResult>, [LlmMessage[], unknown[]]>(),
  };
  const tools = researchTools();
  const drafts = new InMemoryTripDraftStore();
  const orchestrator = new Orchestrator({
    conversationStore: store,
    tripDraftStore: drafts,
    llm,
    planner: new PlannerAgent(),
    research: new ResearchAgent(tools.registry),
    budget: new BudgetAgent(),
    critic: new CriticAgent(),
    today: () => TODAY,
  });
  const events: RunEvent[] = [];
  const emitter = new RunEventEmitter((event) => events.push(event));
  const run = (message: string) =>
    orchestrator.run(
      { runId: 'run-1', userId: 'user-a', sessionId: 's1', message },
      (type, data) => emitter.emit(type, data),
    );
  return { run, llm, events, emitter, stored, tools, drafts };
}

// Kurzform eines Ereignisses für die erwartete Reihenfolge
function label(event: RunEvent): string {
  switch (event.type) {
    case 'agent.started':
    case 'agent.finished':
      return `${event.type} ${event.data.agent}/${event.data.task}`;
    case 'llm.started':
    case 'llm.call':
      return `${event.type} ${event.data.agent}`;
    case 'tool.started':
    case 'tool.finished':
      return `${event.type} ${event.data.tool}`;
    case 'place.added':
      return `place.added ${event.data.kind}`;
    default:
      return event.type;
  }
}

function draftOf(events: RunEvent[]): RunEventPayloads['itinerary.draft'] {
  const drafts = events.filter((e) => e.type === 'itinerary.draft');
  expect(drafts).toHaveLength(1);
  return drafts[0].data;
}

describe('Orchestrator', () => {
  it('Szenario "3 Tage Lissabon im Oktober, 800 €, ab Berlin": Ereignisfolge und höchstens 4 LLM-Aufrufe', async () => {
    const { run, llm, events, emitter } = setup();
    llm.chat
      .mockResolvedValueOnce(reply(TRIAGE, 900, 250))
      .mockResolvedValueOnce(reply(COMPOSE, 1400, 900))
      .mockResolvedValueOnce(
        reply(
          '## 3 Tage Lissabon\nLaut **Lissabon – Reiseziel-Überblick** …',
          1300,
          700,
        ),
      );

    const result = await run('3 Tage Lissabon im Oktober, 800 €, ab Berlin');

    const labels = events.map(label);
    // Vor der Recherche: triage (1 LLM), plan (Code)
    expect(labels.slice(0, 8)).toEqual([
      'agent.started planner/triage',
      'llm.started planner',
      'llm.call planner',
      'agent.finished planner/triage',
      'agent.started planner/plan',
      'agent.finished planner/plan',
      'plan.updated',
      // Alle Recherche-Aufgaben starten, bevor eine fertig ist
      'plan.updated',
    ]);
    const research = labels.slice(
      labels.indexOf('agent.started research/research:weather') - 1,
      labels.indexOf('agent.started planner/compose') - 1,
    );
    expect(research.filter((l) => l.startsWith('agent.started'))).toEqual([
      'agent.started research/research:weather',
      'agent.started research/research:lodging',
      'agent.started research/research:transport',
      'agent.started research/research:knowledge',
    ]);
    expect(
      research.filter((l) => l.startsWith('agent.finished')).sort(),
    ).toEqual([
      'agent.finished research/research:knowledge',
      'agent.finished research/research:lodging',
      'agent.finished research/research:transport',
      'agent.finished research/research:weather',
    ]);
    for (const expected of [
      'tool.started get_weather',
      'tool.finished search_lodging',
      'weather.updated',
      'lodging.updated',
      'place.added destination',
      'place.added origin',
      'route.added',
    ]) {
      expect(research).toContain(expected);
    }
    // Nach der Recherche: compose (1 LLM), budget (Code), final (1 LLM und
    // der Entwurf; gespeichert wird nichts)
    const after = labels
      .slice(labels.indexOf('agent.started planner/compose'))
      .filter((l) => l !== 'plan.updated');
    expect(after).toEqual([
      'agent.started planner/compose',
      'llm.started planner',
      'llm.call planner',
      'agent.finished planner/compose',
      'agent.started budget/budget',
      'budget.updated',
      'agent.finished budget/budget',
      'agent.started critic/critique',
      'critique',
      'agent.finished critic/critique',
      'agent.started planner/final',
      'llm.started planner',
      'llm.call planner',
      'itinerary.draft',
      'agent.finished planner/final',
    ]);

    // Definition of Done: höchstens 4 LLM-Aufrufe, Budget der Tokens
    const totals = emitter.totals();
    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(totals.llmCalls).toBeLessThanOrEqual(4);
    expect(totals.inputTokens + totals.outputTokens).toBeLessThanOrEqual(7_000);

    // Kein Tool speichert, der Plan kommt als Entwurf: alle Stops mit
    // Koordinaten, Budget = genanntes Budget, Annahmen dabei
    expect(labels).not.toContain('tool.started save_itinerary');
    const { itinerary, assumptions } = draftOf(events);
    expect(itinerary).toMatchObject({
      destination: 'Lissabon',
      startDate: '2026-10-14',
      endDate: '2026-10-16',
      budgetCents: 80_000,
      currency: 'EUR',
    });
    expect(itinerary.stops).toHaveLength(6);
    expect(
      itinerary.stops.every((s) => s.lat !== undefined && s.lng !== undefined),
    ).toBe(true);
    expect(assumptions).toEqual(['1 Person', 'Unterkunft: Mittelklasse']);
    const budget = events.find((e) => e.type === 'budget.updated')
      ?.data as RunEventPayloads['budget.updated'];
    expect(budget.limitCents).toBe(80_000);
    expect(result.reply).toMatch(/^## 3 Tage Lissabon/);
    expect(result.route).toHaveLength(6);
    expect(result.focus?.name).toBe('Lissabon');
    expect(result.searchAttempted).toBe(true);
    expect(result.sources.map((s) => s.title)).toEqual([
      'Lissabon – Reiseziel-Überblick',
    ]);

    // Am Ende ist jede Aufgabe erledigt
    const lastPlan = events.filter((e) => e.type === 'plan.updated').at(-1)
      ?.data as RunEventPayloads['plan.updated'];
    expect(lastPlan.tasks.map((t) => t.status)).toEqual(
      Array(lastPlan.tasks.length).fill('done'),
    );
  });

  it('Rückfrage: "Ich will verreisen" braucht genau 1 LLM-Aufruf und keine Recherche', async () => {
    const { run, llm, events, tools, stored } = setup();
    llm.chat.mockResolvedValueOnce(
      reply(
        '{"status":"ask","question":"Wohin und wann möchtest du reisen?"}',
        700,
        60,
      ),
    );

    const result = await run('Ich will verreisen');

    expect(llm.chat).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe('Wohin und wann möchtest du reisen?');
    expect(events.map(label)).toEqual([
      'agent.started planner/triage',
      'llm.started planner',
      'llm.call planner',
      'agent.finished planner/triage',
    ]);
    expect(tools.openMeteo.geocode).not.toHaveBeenCalled();
    expect(tools.overpass.lodgings).not.toHaveBeenCalled();
    // Der Dialog ist gespeichert, die Antwort darauf kennt die Rückfrage
    expect(stored.get('user-a:s1')?.map((m) => m.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('meldet einen gescheiterten Plan als Fehler, ohne Entwurf', async () => {
    const { run, llm, events } = setup();
    llm.chat
      .mockResolvedValueOnce(reply(TRIAGE, 1, 1))
      .mockResolvedValueOnce(reply('kaputt', 1, 1))
      .mockResolvedValueOnce(reply('immer noch kaputt', 1, 1));

    await expect(run('3 Tage Lissabon im Oktober')).rejects.toThrow(
      /Reparaturversuch/,
    );

    expect(llm.chat).toHaveBeenCalledTimes(3);
    expect(events.some((e) => e.type === 'itinerary.draft')).toBe(false);
    const lastPlan = events.filter((e) => e.type === 'plan.updated').at(-1)
      ?.data as RunEventPayloads['plan.updated'];
    expect(lastPlan.tasks.find((t) => t.id === 'compose')?.status).toBe(
      'error',
    );
  });

  it('der Entwurf passiert POST /itineraries unverändert (ValidationPipe wie in main.ts)', async () => {
    const { run, llm, events } = setup();
    llm.chat
      .mockResolvedValueOnce(reply(TRIAGE, 1, 1))
      .mockResolvedValueOnce(reply(COMPOSE, 1, 1))
      .mockResolvedValueOnce(reply('## Entwurf', 1, 1));
    await run('3 Tage Lissabon im Oktober, 800 €, ab Berlin');
    // Genau der Body, den "Plan speichern" im Frontend schickt
    const body: unknown = JSON.parse(JSON.stringify(draftOf(events).itinerary));

    // forbidNonWhitelisted: kein Feld, das die API nicht kennt
    const strict = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
    const dto: unknown = await strict.transform(body, {
      type: 'body',
      metatype: CreateItineraryDto,
    });
    expect(dto).toBeInstanceOf(CreateItineraryDto);
    expect(JSON.parse(JSON.stringify(dto))).toEqual(body);
  });

  it('bricht nach Ablauf des Laufzeitlimits ab', async () => {
    const { llm } = setup();
    const controller = new AbortController();
    controller.abort();
    const orchestrator = new Orchestrator({
      conversationStore: {
        load: () => Promise.resolve([]),
        save: () => Promise.resolve(),
      },
      tripDraftStore: new InMemoryTripDraftStore(),
      llm,
      planner: {} as PlannerAgent,
      research: {} as ResearchAgent,
      budget: new BudgetAgent(),
      critic: new CriticAgent(),
    });

    await expect(
      orchestrator.run(
        { runId: 'r', userId: 'u', sessionId: 's', message: 'x' },
        () => undefined,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

// Zeichen aller Nachrichten an das LLM ab Aufruf `from`: Maß für die
// Input-Tokens (~3,5 Zeichen pro Token), unabhängig von den gemockten
// usage-Werten
function promptChars(llm: ReturnType<typeof setup>['llm'], from = 0): number {
  return llm.chat.mock.calls
    .slice(from)
    .flatMap(([messages]) => messages)
    .reduce((sum, message) => sum + (message.content ?? '').length, 0);
}

describe('Orchestrator: Entwurf per Folgenachricht anpassen', () => {
  // So lang wie eine echte Plan-Antwort (~2.500 Zeichen)
  const FIRST_REPLY =
    '## 3 Tage Lissabon\n' +
    'Tag für Tag mit Wetter und Unterkünften. '.repeat(60);

  // Erstplan wie im Szenario oben; liefert den Entwurf und den Stand danach
  async function firstPlan(ctx: ReturnType<typeof setup>) {
    // Drei Treffer in voller Länge wie im Betrieb (research.agent kürzt auf
    // 3 × 500 Zeichen), damit der Vergleich der Prompt-Größen realistisch ist
    (searchTravelKnowledge as jest.Mock).mockResolvedValue({
      available: true,
      results: ['Alfama', 'Belém', 'Essen'].map((title, i) => ({
        content: `${title}: ${'Viertel, Aussichtspunkte und Cafés. '.repeat(20)}`,
        title: `Lissabon – ${title}`,
        source: 'Eigene Recherche',
        license: 'Eigene Inhalte',
        url: null,
        score: 0.9 - i / 10,
      })),
    });
    ctx.llm.chat
      .mockResolvedValueOnce(reply(TRIAGE, 900, 250))
      .mockResolvedValueOnce(reply(COMPOSE, 1400, 900))
      .mockResolvedValueOnce(reply(FIRST_REPLY, 1300, 700));
    await ctx.run('3 Tage Lissabon im Oktober, 800 €, ab Berlin');
    const draft = draftOf(ctx.events);
    const stored = (await ctx.drafts.load('user-a', 's1'))!;
    const counts = {
      geocode: ctx.tools.openMeteo.geocode.mock.calls.length,
      weather: ctx.tools.openMeteo.dailyWeather.mock.calls.length,
      lodgings: ctx.tools.overpass.lodgings.mock.calls.length,
      knowledge: (searchTravelKnowledge as jest.Mock).mock.calls.length,
    };
    const calls = ctx.llm.chat.mock.calls.length;
    const chars = promptChars(ctx.llm);
    const totals = ctx.emitter.totals();
    ctx.events.length = 0;
    return { draft, stored, counts, calls, chars, totals };
  }

  function stopsOfDay(draft: RunEventPayloads['itinerary.draft'], day: number) {
    return draft.itinerary.stops.filter((stop) => stop.dayNumber === day);
  }

  function lastPlanOf(events: RunEvent[]) {
    return events.filter((e) => e.type === 'plan.updated').at(-1)
      ?.data as RunEventPayloads['plan.updated'];
  }

  it('"Tag 2 entspannter": nur Tag 2 neu, Tag 1 und 3 identisch, keine Recherche, höchstens 3 LLM-Aufrufe', async () => {
    const ctx = setup();
    const first = await firstPlan(ctx);
    expect(first.stored.revision).toBe(1);
    ctx.llm.chat
      .mockResolvedValueOnce(
        reply(
          JSON.stringify({
            status: 'ready',
            intent: 'revise',
            days: [2],
            changes: {},
            summary: 'Tag 2 ruhiger',
          }),
          1000,
          60,
        ),
      )
      .mockResolvedValueOnce(
        reply(
          JSON.stringify({
            stops: [
              {
                dayNumber: 2,
                order: 1,
                title: 'Ausschlafen und Pastéis de Nata',
                category: 'FOOD',
                costCents: 500,
                lat: 38.7,
                lng: -9.2,
              },
              {
                dayNumber: 2,
                order: 2,
                title: 'Museu Nacional do Azulejo',
                category: 'CULTURE',
                costCents: 800,
                lat: 38.72,
                lng: -9.11,
              },
            ],
          }),
          700,
          250,
        ),
      )
      .mockResolvedValueOnce(
        reply('### Tag 2\n- Ausschlafen\n\nUnverändert: Tag 1 und 3', 900, 300),
      );

    const result = await ctx.run('Mach Tag 2 entspannter');

    // Höchstens 3 LLM-Aufrufe: triage, revise, final
    expect(ctx.llm.chat).toHaveBeenCalledTimes(first.calls + 3);
    expect(ctx.emitter.totals().llmCalls - first.totals.llmCalls).toBe(3);
    // Deutlich weniger Tokens als der Erstplan: Die Prompts (gemessen in
    // Zeichen) sind unter 70 %, mit den kürzeren Ausgaben (usage wie in der
    // Token-Rechnung der Doku) liegt der ganze Lauf unter 60 %
    expect(promptChars(ctx.llm, first.calls)).toBeLessThan(first.chars * 0.7);
    const totals = ctx.emitter.totals();
    const firstTokens = first.totals.inputTokens + first.totals.outputTokens;
    const revisionTokens =
      totals.inputTokens + totals.outputTokens - firstTokens;
    expect(revisionTokens).toBeLessThan(firstTokens * 0.6);

    // Keine Recherche: kein Tool, keine API
    const labels = ctx.events.map(label);
    expect(labels.filter((l) => l.startsWith('tool.'))).toEqual([]);
    expect(ctx.tools.openMeteo.geocode).toHaveBeenCalledTimes(
      first.counts.geocode,
    );
    expect(ctx.tools.overpass.lodgings).toHaveBeenCalledTimes(
      first.counts.lodgings,
    );
    expect(searchTravelKnowledge as jest.Mock).toHaveBeenCalledTimes(
      first.counts.knowledge,
    );
    expect(labels.filter((l) => l !== 'plan.updated')).toEqual([
      'agent.started planner/triage',
      'llm.started planner',
      'llm.call planner',
      'agent.finished planner/triage',
      'agent.started planner/plan',
      'agent.finished planner/plan',
      'agent.started planner/revise',
      'llm.started planner',
      'llm.call planner',
      'agent.finished planner/revise',
      'agent.started budget/budget',
      'budget.updated',
      'agent.finished budget/budget',
      'agent.started critic/critique',
      'critique',
      'agent.finished critic/critique',
      'agent.started planner/final',
      'llm.started planner',
      'llm.call planner',
      'itinerary.draft',
      'agent.finished planner/final',
    ]);
    expect(lastPlanOf(ctx.events).tasks.map((t) => [t.id, t.status])).toEqual([
      ['revise', 'done'],
      ['budget', 'done'],
      ['critique', 'done'],
      ['final', 'done'],
    ]);

    // Nur Tag 2 ist neu, Tag 1 und 3 exakt wie vorher
    const revised = draftOf(ctx.events);
    expect(stopsOfDay(revised, 1)).toEqual(stopsOfDay(first.draft, 1));
    expect(stopsOfDay(revised, 3)).toEqual(stopsOfDay(first.draft, 3));
    expect(stopsOfDay(revised, 2).map((s) => s.title)).toEqual([
      'Ausschlafen und Pastéis de Nata',
      'Museu Nacional do Azulejo',
    ]);
    expect(revised).toMatchObject({ revision: 2, change: 'Tag 2 ruhiger' });
    expect(first.draft.revision).toBe(1);
    expect(first.draft.change).toBeUndefined();

    // Die Antwort beginnt mit der Änderung
    expect(result.reply).toMatch(
      /^\*\*Geändert:\*\* Tag 2 ruhiger\n\n### Tag 2/,
    );
    // Die Recherche des Erstplans gilt weiter
    expect(result.focus?.name).toBe('Lissabon');
    expect(result.route).toHaveLength(6);

    // triage kennt den Entwurf als Kurzfassung, die lange Antwort nur gekürzt
    const [triageMessages] = ctx.llm.chat.mock.calls[first.calls];
    expect(triageMessages[0].content).toContain('Museu Nacional do Azulejo');
    const previous = triageMessages.find((m) => m.role === 'assistant');
    expect(previous?.content?.length).toBeLessThanOrEqual(300);
    // revise sieht Tag 2 vollständig, die anderen nur als Titel
    const [reviseMessages] = ctx.llm.chat.mock.calls[first.calls + 1];
    const facts = JSON.parse(reviseMessages[1].content!) as {
      Wunsch: string;
      Reise: { Tage: { dayNumber: number }[]; AndereTage: object };
    };
    expect(facts.Wunsch).toBe('Mach Tag 2 entspannter');
    expect(facts.Reise.Tage.map((s) => s.dayNumber)).toEqual([2, 2]);
    expect(facts.Reise.AndereTage).toEqual({
      1: ['Ankunft', 'Alfama und Tram 28'],
      3: ['Belém', 'Abreise'],
    });

    // Gespeichert ist die neue Fassung mit der alten Recherche
    const stored = await ctx.drafts.load('user-a', 's1');
    expect(stored?.revision).toBe(2);
    expect(stored?.draft.stops).toEqual(revised.itinerary.stops);
    expect(stored?.findings).toEqual(first.stored.findings);
  });

  it('"günstiger übernachten": nur research:lodging läuft neu, Programm bleibt, Unterkunft wird billiger', async () => {
    const ctx = setup();
    const first = await firstPlan(ctx);
    ctx.llm.chat
      .mockResolvedValueOnce(
        reply(
          JSON.stringify({
            status: 'ready',
            intent: 'revise',
            days: [],
            changes: { lodging: 'budget' },
            summary: 'Unterkunft günstiger',
          }),
          1000,
          60,
        ),
      )
      .mockResolvedValueOnce(reply('Günstiger: **Casa Baixa**', 800, 250));

    const result = await ctx.run('Lieber günstiger übernachten');

    // triage und final, kein revise
    expect(ctx.llm.chat).toHaveBeenCalledTimes(first.calls + 2);
    const labels = ctx.events.map(label);
    expect(
      labels.filter((l) => l.startsWith('agent.started research')),
    ).toEqual(['agent.started research/research:lodging']);
    expect(labels.filter((l) => l.startsWith('tool.started'))).toEqual([
      'tool.started search_lodging',
    ]);
    expect(labels).not.toContain('agent.started planner/revise');
    expect(labels).not.toContain('agent.started planner/compose');
    expect(ctx.tools.overpass.lodgings).toHaveBeenCalledTimes(
      first.counts.lodgings + 1,
    );
    expect(ctx.tools.openMeteo.dailyWeather).toHaveBeenCalledTimes(
      first.counts.weather,
    );
    expect(searchTravelKnowledge as jest.Mock).toHaveBeenCalledTimes(
      first.counts.knowledge,
    );
    expect(lastPlanOf(ctx.events).tasks.map((t) => [t.id, t.status])).toEqual([
      ['research:lodging', 'done'],
      ['budget', 'done'],
      ['critique', 'done'],
      ['final', 'done'],
    ]);

    // Programm unverändert, die Annahme zur Unterkunft ist überholt
    const revised = draftOf(ctx.events);
    expect(revised.itinerary.stops).toEqual(first.draft.itinerary.stops);
    expect(revised.revision).toBe(2);
    expect(revised.assumptions).toEqual(['1 Person']);
    // Unterkunft billiger (nur die Pension passt unter die Grenze), Anreise
    // und Programm gleich
    const budget = ctx.events.find((e) => e.type === 'budget.updated')
      ?.data as RunEventPayloads['budget.updated'];
    const cents = (report: typeof budget, category: string) =>
      report.items.find((item) => item.category === category)?.cents;
    const before = first.stored.budget!;
    expect(cents(budget, 'lodging')).toBeLessThan(cents(before, 'lodging')!);
    expect(cents(budget, 'transport')).toBe(cents(before, 'transport'));
    expect(cents(budget, 'activities')).toBe(cents(before, 'activities'));
    expect(result.reply).toMatch(/^\*\*Geändert:\*\* Unterkunft günstiger/);

    // Gespeichert: neue Unterkünfte, altes Wetter und alte Treffer
    const stored = await ctx.drafts.load('user-a', 's1');
    expect(stored?.brief.lodging).toBe('budget');
    expect(stored?.findings.weather).toEqual(first.stored.findings.weather);
    expect(stored?.findings.knowledge).toEqual(first.stored.findings.knowledge);
    expect(stored?.findings.lodging?.items[0].name).toBe('Casa Baixa');
  });

  it('"Lieber nach Porto": neue Reise mit voller Recherche, der alte Entwurf wird ersetzt', async () => {
    const ctx = setup();
    const first = await firstPlan(ctx);
    const brief = JSON.parse(TRIAGE) as Record<string, unknown>;
    ctx.llm.chat
      .mockResolvedValueOnce(
        reply(
          JSON.stringify({ ...brief, intent: 'new', destination: 'Porto' }),
          1000,
          250,
        ),
      )
      .mockResolvedValueOnce(reply(COMPOSE_PORTO, 1400, 900))
      .mockResolvedValueOnce(reply('## 3 Tage Porto', 1300, 700));

    const result = await ctx.run('Lieber nach Porto');

    expect(ctx.llm.chat).toHaveBeenCalledTimes(first.calls + 3);
    const labels = ctx.events.map(label);
    expect(
      labels.filter((l) => l.startsWith('agent.started research')),
    ).toEqual([
      'agent.started research/research:weather',
      'agent.started research/research:lodging',
      'agent.started research/research:transport',
      'agent.started research/research:knowledge',
    ]);
    expect(labels).toContain('agent.started planner/compose');
    expect(labels).not.toContain('agent.started planner/revise');
    const draft = draftOf(ctx.events);
    expect(draft.itinerary.destination).toBe('Porto');
    expect(draft.revision).toBe(1);
    expect(draft.change).toBeUndefined();
    expect(result.reply).toBe('## 3 Tage Porto');
    expect(result.focus?.name).toBe('Porto');
    const stored = await ctx.drafts.load('user-a', 's1');
    expect(stored?.revision).toBe(1);
    expect(stored?.brief.destination).toBe('Porto');
    expect(stored?.findings.destination?.name).toBe('Porto');
  });

  it('eine Rückfrage lässt den gespeicherten Entwurf stehen', async () => {
    const ctx = setup();
    await firstPlan(ctx);
    ctx.llm.chat.mockResolvedValueOnce(
      reply('{"status":"ask","question":"Welcher Tag?"}', 900, 30),
    );

    const result = await ctx.run('Mach es anders');

    expect(result.reply).toBe('Welcher Tag?');
    expect((await ctx.drafts.load('user-a', 's1'))?.revision).toBe(1);
  });

  it('ein gescheiterter Lauf überschreibt den Entwurf nicht', async () => {
    const ctx = setup();
    await firstPlan(ctx);
    ctx.llm.chat
      .mockResolvedValueOnce(
        reply(
          '{"status":"ready","intent":"revise","days":[2],"changes":{},"summary":"Tag 2 ruhiger"}',
          1,
          1,
        ),
      )
      .mockResolvedValueOnce(reply('kaputt', 1, 1))
      .mockResolvedValueOnce(reply('immer noch kaputt', 1, 1));

    await expect(ctx.run('Tag 2 entspannter')).rejects.toThrow(
      /Reparaturversuch/,
    );
    expect((await ctx.drafts.load('user-a', 's1'))?.revision).toBe(1);
    expect(
      lastPlanOf(ctx.events).tasks.find((t) => t.id === 'revise')?.status,
    ).toBe('error');
  });
});

describe('Orchestrator: Kritiker und Nachbesserung', () => {
  // Tag 2 (15.10.) regnet es laut Recherche-Fixture 6 mm: Ein Aussichtspunkt
  // draußen ist ein Fehler, den der Planer nachbessern muss
  const RAINY_COMPOSE = JSON.stringify({
    stops: (
      JSON.parse(COMPOSE) as { stops: Record<string, unknown>[] }
    ).stops.map((stop) =>
      stop.title === 'Museu Nacional do Azulejo'
        ? {
            ...stop,
            title: 'Miradouro da Senhora do Monte',
            category: 'SIGHTSEEING',
            outdoor: true,
            lat: 38.719,
            lng: -9.132,
          }
        : stop,
    ),
  });
  const day2 = (title: string, outdoor: boolean) =>
    JSON.stringify({
      stops: [
        {
          dayNumber: 2,
          order: 1,
          title,
          category: outdoor ? 'SIGHTSEEING' : 'CULTURE',
          costCents: 800,
          lat: 38.72,
          lng: -9.11,
          outdoor,
        },
        {
          dayNumber: 2,
          order: 2,
          title: 'Time Out Market',
          category: 'FOOD',
          lat: 38.71,
          lng: -9.15,
          outdoor: false,
        },
      ],
    });

  function critiques(events: RunEvent[]) {
    return events.filter((e) => e.type === 'critique').map((e) => e.data);
  }

  function lastUserPrompt(llm: ReturnType<typeof setup>['llm']): string {
    const messages = llm.chat.mock.calls.at(-1)![0];
    return messages.at(-1)!.content ?? '';
  }

  it('Regentag: Kritiker findet den Aussichtspunkt, der Planer tauscht nur Tag 2, die zweite Prüfung ist sauber', async () => {
    const { run, llm, events } = setup();
    llm.chat
      .mockResolvedValueOnce(reply(TRIAGE, 900, 250))
      .mockResolvedValueOnce(reply(RAINY_COMPOSE, 1400, 900))
      .mockResolvedValueOnce(
        reply(day2('Museu Nacional do Azulejo', false), 900, 300),
      )
      .mockResolvedValueOnce(reply('## 3 Tage Lissabon', 1300, 700));

    await run('3 Tage Lissabon im Oktober, 800 €, ab Berlin');

    const labels = events.map(label).filter((l) => l !== 'plan.updated');
    const after = labels.slice(
      labels.indexOf('agent.finished planner/compose') + 1,
    );
    expect(after).toEqual([
      'agent.started budget/budget',
      'budget.updated',
      'agent.finished budget/budget',
      'agent.started critic/critique',
      'critique',
      'agent.finished critic/critique',
      'agent.started planner/repair',
      'llm.started planner',
      'llm.call planner',
      'agent.finished planner/repair',
      'agent.started budget/budget',
      'budget.updated',
      'agent.finished budget/budget',
      'agent.started critic/critique',
      'critique',
      'agent.finished critic/critique',
      'agent.started planner/final',
      'llm.started planner',
      'llm.call planner',
      'itinerary.draft',
      'agent.finished planner/final',
    ]);
    expect(llm.chat).toHaveBeenCalledTimes(4);

    const [first, second] = critiques(events);
    expect(first.round).toBe(0);
    expect(first.final).toBe(false);
    expect(first.violations.filter((v) => v.severity === 'error')).toEqual([
      {
        ruleId: 'rain-outdoor',
        severity: 'error',
        dayNumber: 2,
        stopTitle: 'Miradouro da Senhora do Monte',
        lat: 38.719,
        lng: -9.132,
        message:
          'Miradouro da Senhora do Monte liegt draußen, an Tag 2 regnet es (6 mm, Vorjahreswert)',
      },
    ]);
    expect(second).toMatchObject({
      round: 1,
      final: true,
      changes: [
        {
          dayNumber: 2,
          removed: ['Miradouro da Senhora do Monte'],
          added: ['Museu Nacional do Azulejo'],
        },
      ],
    });
    expect(second.violations.filter((v) => v.severity === 'error')).toEqual([]);

    // Die Nachbesserung bekam nur Tag 2 und den Befund, nicht den Wunsch
    const repairFacts = JSON.parse(
      llm.chat.mock.calls[2][0].at(-1)!.content!,
    ) as Record<string, unknown>;
    expect(repairFacts.Kritik).toEqual([first.violations[0].message]);
    expect(repairFacts).not.toHaveProperty('Wunsch');

    // Checkliste: repair-1 steht vor final, alles erledigt
    const plan = events.filter((e) => e.type === 'plan.updated').at(-1)!.data;
    expect(plan.tasks.slice(-4).map((t) => [t.id, t.status])).toEqual([
      ['budget', 'done'],
      ['critique', 'done'],
      ['repair-1', 'done'],
      ['final', 'done'],
    ]);
    const { itinerary } = draftOf(events);
    expect(
      itinerary.stops.filter((s) => s.dayNumber === 2).map((s) => s.title),
    ).toEqual(['Museu Nacional do Azulejo', 'Time Out Market']);
    // outdoor gehört nur zum Entwurf, nicht zum speicherbaren Plan
    expect(itinerary.stops.some((s) => 'outdoor' in s)).toBe(false);
  });

  it('ein sturer Planer: höchstens 2 Nachbesserungen, danach nennt die Antwort den offenen Fehler', async () => {
    const { run, llm, events } = setup();
    const stubborn = day2('Miradouro da Senhora do Monte', true);
    llm.chat
      .mockResolvedValueOnce(reply(TRIAGE, 900, 250))
      .mockResolvedValueOnce(reply(RAINY_COMPOSE, 1400, 900))
      .mockResolvedValueOnce(reply(stubborn, 900, 300))
      .mockResolvedValueOnce(reply(stubborn, 900, 300))
      .mockResolvedValueOnce(reply('## 3 Tage Lissabon', 1300, 700));

    const result = await run('3 Tage Lissabon im Oktober, 800 €, ab Berlin');

    expect(llm.chat).toHaveBeenCalledTimes(5);
    expect(
      events.map(label).filter((l) => l === 'agent.started planner/repair'),
    ).toHaveLength(2);
    const rounds = critiques(events);
    expect(rounds.map((c) => [c.round, c.final])).toEqual([
      [0, false],
      [1, false],
      [2, true],
    ]);
    expect(rounds[2].violations[0]).toMatchObject({
      ruleId: 'rain-outdoor',
      severity: 'error',
    });
    const facts = JSON.parse(lastUserPrompt(llm)) as { Hinweise: string[] };
    expect(facts.Hinweise).toContain(rounds[2].violations[0].message);
    expect(result.reply).toBe('## 3 Tage Lissabon');
  });

  it('eine gescheiterte Nachbesserung kostet nicht den Plan: der geprüfte Entwurf geht mit Hinweis raus', async () => {
    const { run, llm, events } = setup();
    llm.chat
      .mockResolvedValueOnce(reply(TRIAGE, 900, 250))
      .mockResolvedValueOnce(reply(RAINY_COMPOSE, 1400, 900))
      .mockResolvedValueOnce(reply('kein JSON', 900, 10))
      .mockResolvedValueOnce(reply('immer noch kein JSON', 900, 10))
      .mockResolvedValueOnce(reply('## 3 Tage Lissabon', 1300, 700));

    await run('3 Tage Lissabon im Oktober, 800 €, ab Berlin');

    expect(events.map((e) => e.type)).not.toContain('run.error');
    const repair = events.find(
      (e) => e.type === 'agent.finished' && e.data.task === 'repair',
    );
    expect(repair?.data).toMatchObject({ status: 'error' });
    const { itinerary } = draftOf(events);
    expect(itinerary.stops.map((s) => s.title)).toContain(
      'Miradouro da Senhora do Monte',
    );
    const facts = JSON.parse(lastUserPrompt(llm)) as { Hinweise: string[] };
    expect(facts.Hinweise[0]).toMatch(
      /Miradouro da Senhora do Monte liegt draußen/,
    );
  });
});
