import { ValidationPipe } from '@nestjs/common';
import { CreateItineraryDto } from '../itinerary.dto';
import type { ConversationStore } from '../llm/conversation-store';
import type { LlmChatResult, LlmMessage } from '../llm/llm-provider.interface';
import { RunEventEmitter } from '../runs/run-event-emitter';
import type { RunEvent, RunEventPayloads } from '../runs/run-events';
import { BudgetAgent } from './agents/budget.agent';
import { PlannerAgent } from './agents/planner.agent';
import { ResearchAgent } from './agents/research.agent';
import { Orchestrator } from './orchestrator';
import { TODAY, researchTools } from './testing.fixtures';

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
  const orchestrator = new Orchestrator({
    conversationStore: store,
    llm,
    planner: new PlannerAgent(),
    research: new ResearchAgent(tools.registry),
    budget: new BudgetAgent(),
    today: () => TODAY,
  });
  const events: RunEvent[] = [];
  const emitter = new RunEventEmitter((event) => events.push(event));
  const run = (message: string) =>
    orchestrator.run(
      { runId: 'run-1', userId: 'user-a', sessionId: 's1', message },
      (type, data) => emitter.emit(type, data),
    );
  return { run, llm, events, emitter, stored, tools };
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
      llm,
      planner: {} as PlannerAgent,
      research: {} as ResearchAgent,
      budget: new BudgetAgent(),
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
