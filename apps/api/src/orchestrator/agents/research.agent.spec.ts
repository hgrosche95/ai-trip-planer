import { searchTravelKnowledge } from '../../rag-client';
import type { RunEventPayloads } from '../../runs/run-events';
import {
  LISBON_BRIEF,
  PLACES,
  researchTools,
  testContext,
} from '../testing.fixtures';
import type { PlanTask } from '../trip-draft';
import { ResearchAgent } from './research.agent';

jest.mock('../../rag-client', () => ({ searchTravelKnowledge: jest.fn() }));

const brief = LISBON_BRIEF;

function task(type: PlanTask['type']): PlanTask {
  return {
    id: type,
    type,
    agent: 'research',
    dependsOn: ['plan'],
    status: 'pending',
  };
}

const ALL_TASKS = [
  task('research:weather'),
  task('research:lodging'),
  task('research:transport'),
  task('research:knowledge'),
];

describe('ResearchAgent', () => {
  it('bildet jede Aufgabe auf ihr Tool ab und sammelt die Kennzahlen', async () => {
    const { registry } = researchTools();
    const { ctx } = testContext();

    const findings = await new ResearchAgent(registry).run(
      { brief, tasks: ALL_TASKS },
      ctx,
    );

    expect(findings.destination).toEqual(PLACES.lissabon);
    expect(findings.origin).toEqual(PLACES.berlin);
    expect(findings.weather?.days).toHaveLength(3);
    expect(findings.weather?.source).toBe('climate');
    expect(findings.lodging?.items.map((item) => item.name)).toEqual([
      'Hotel Alfama',
      'Casa Baixa',
    ]);
    expect(findings.lodging?.priceBasis).toMatch(/Lissabon/);
    expect(findings.transport?.recommended).toBe('flight');
    expect(findings.knowledge).toEqual([
      {
        title: 'Lissabon – Reiseziel-Überblick',
        source: 'Eigene Recherche',
        content: 'Die Tram 28 fährt durch die Alfama.',
      },
    ]);
    expect(findings.sources).toHaveLength(1);
    expect(findings.searchAttempted).toBe(true);
  });

  it('startet alle Aufgaben, bevor die erste fertig ist (parallel)', async () => {
    const { registry } = researchTools();
    const { ctx, events } = testContext();

    await new ResearchAgent(registry).run({ brief, tasks: ALL_TASKS }, ctx);

    const types = events.map((event) => event.type);
    const lastStart = types.lastIndexOf('agent.started');
    const firstFinish = types.indexOf('agent.finished');
    expect(types.filter((type) => type === 'agent.started')).toHaveLength(4);
    expect(lastStart).toBeLessThan(firstFinish);
  });

  it('schickt dieselben Ereignisse wie der Classic-Agent, mit agent und parentStepId', async () => {
    const { registry } = researchTools();
    const { ctx, events } = testContext();

    await new ResearchAgent(registry).run({ brief, tasks: ALL_TASKS }, ctx);

    const types = events.map((event) => event.type);
    for (const type of [
      'tool.started',
      'tool.finished',
      'weather.updated',
      'lodging.updated',
      'place.added',
      'route.added',
    ] as const) {
      expect(types).toContain(type);
    }
    const started = events.filter((e) => e.type === 'agent.started');
    const stepIds = started.map(
      (e) => (e.data as RunEventPayloads['agent.started']).stepId,
    );
    for (const event of events.filter((e) => e.type === 'tool.started')) {
      const data = event.data as RunEventPayloads['tool.started'];
      expect(data.agent).toBe('research');
      expect(stepIds).toContain(data.parentStepId);
    }
    // Ziel genau einmal als destination, Abreiseort als origin mit Bogen
    const places = events
      .filter((e) => e.type === 'place.added')
      .map((e) => e.data as RunEventPayloads['place.added']);
    expect(places.filter((p) => p.kind === 'destination')).toEqual([
      { ...PLACES.lissabon, kind: 'destination' },
    ]);
    expect(places.filter((p) => p.kind === 'origin')).toEqual([
      { ...PLACES.berlin, kind: 'origin' },
    ]);
  });

  it('meldet jeden Statuswechsel und die Zusammenfassung ohne Freitext', async () => {
    const { registry } = researchTools();
    const { ctx, events } = testContext();
    const statuses: string[] = [];

    await new ResearchAgent(registry).run(
      {
        brief,
        tasks: [task('research:weather')],
        onTaskStatus: (id, status) => statuses.push(`${id}:${status}`),
      },
      ctx,
    );

    expect(statuses).toEqual([
      'research:weather:running',
      'research:weather:done',
    ]);
    const finished = events.find((e) => e.type === 'agent.finished')
      ?.data as RunEventPayloads['agent.finished'];
    expect(finished).toMatchObject({
      agent: 'research',
      task: 'research:weather',
      status: 'ok',
      summary: '3 Tage, Vorjahreswerte',
    });
  });

  it('eine ausgefallene API macht nur ihre Aufgabe zum Fehler', async () => {
    const { registry, overpass } = researchTools();
    overpass.lodgings.mockResolvedValue({
      available: false,
      cached: false,
      error: 'Overpass nicht erreichbar',
    } as never);
    const { ctx, events } = testContext();
    const statuses = new Map<string, string>();

    const findings = await new ResearchAgent(registry).run(
      {
        brief,
        tasks: ALL_TASKS,
        onTaskStatus: (id, status) => statuses.set(id, status),
      },
      ctx,
    );

    expect(statuses.get('research:lodging')).toBe('error');
    expect(statuses.get('research:weather')).toBe('done');
    expect(findings.lodging).toBeUndefined();
    expect(findings.weather).toBeDefined();
    const lodgingStep = events
      .filter((e) => e.type === 'agent.finished')
      .map((e) => e.data as RunEventPayloads['agent.finished'])
      .find((data) => data.task === 'research:lodging');
    expect(lodgingStep?.status).toBe('error');
  });

  it('rechnet ein Budget in fremder Währung mit dem EZB-Kurs um', async () => {
    const { registry, frankfurter } = researchTools();
    const { ctx } = testContext();

    const findings = await new ResearchAgent(registry).run(
      {
        brief: { ...brief, budget: { amount: 3500, currency: 'PLN' } },
        tasks: [task('research:currency')],
      },
      ctx,
    );

    expect(frankfurter.rate).toHaveBeenCalledWith('PLN', 'EUR');
    expect(findings.budgetEurCents).toBe(80_500);
  });

  it('baut die Suchanfrage nur aus Ziel und Präferenzen', async () => {
    const { registry } = researchTools();
    const { ctx } = testContext();

    await new ResearchAgent(registry).run(
      {
        brief: { ...brief, preferences: ['Fado'] },
        tasks: [task('research:knowledge')],
      },
      ctx,
    );

    expect(searchTravelKnowledge).toHaveBeenCalledWith(
      'Lissabon Sehenswürdigkeiten Essen Transport Fado',
    );
  });
});
