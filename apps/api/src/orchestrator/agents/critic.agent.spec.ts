import type { RunEventPayloads } from '../../runs/run-events';
import { LISBON_BRIEF, testContext } from '../testing.fixtures';
import type { DraftStop, ResearchFindings, TripDraft } from '../trip-draft';
import type { BudgetReport } from './budget.agent';
import { CriticAgent, MAX_REPAIRS, dayChanges } from './critic.agent';

const LISBON = { name: 'Lissabon', lat: 38.72, lng: -9.14 };

const FINDINGS: ResearchFindings = {
  destination: LISBON,
  weather: {
    place: LISBON,
    source: 'forecast',
    days: [
      {
        date: '2026-10-14',
        tMin: 15,
        tMax: 22,
        precipMm: 0,
        code: 1,
        label: 'klar',
      },
      {
        date: '2026-10-15',
        tMin: 14,
        tMax: 18,
        precipMm: 14,
        code: 63,
        label: 'Regen',
      },
      {
        date: '2026-10-16',
        tMin: 15,
        tMax: 21,
        precipMm: 0,
        code: 1,
        label: 'klar',
      },
    ],
  },
  knowledge: [],
  sources: [],
  searchAttempted: false,
};

const BUDGET: BudgetReport = {
  currency: 'EUR',
  limitCents: 80_000,
  totalCents: 90_000,
  status: 'over',
  items: [],
};

function draft(stops: Partial<DraftStop>[]): TripDraft {
  return {
    destination: 'Lissabon',
    startDate: '2026-10-14',
    endDate: '2026-10-16',
    budgetCents: 80_000,
    currency: 'EUR',
    preferences: [],
    stops: stops.map((stop, i) => ({
      dayNumber: 1,
      order: i + 1,
      title: `Punkt ${i}`,
      category: 'CULTURE',
      lat: 38.71,
      lng: -9.13,
      ...stop,
    })),
  };
}

const RAINY = draft([
  { dayNumber: 1, order: 1, title: 'Alfama' },
  { dayNumber: 2, order: 1, title: 'Torre de Belém', outdoor: true },
  { dayNumber: 2, order: 2, title: 'Time Out Market', category: 'FOOD' },
  { dayNumber: 3, order: 1, title: 'Gulbenkian' },
]);

describe('CriticAgent', () => {
  it('meldet Befunde als critique-Ereignis und nennt die Tage zum Nachbessern', async () => {
    const { ctx, events } = testContext();

    const critique = await new CriticAgent().run(
      {
        brief: LISBON_BRIEF,
        draft: RAINY,
        findings: FINDINGS,
        budget: BUDGET,
        round: 0,
      },
      ctx,
    );

    expect(critique.repairDays).toEqual([2]);
    expect(critique.violations.map((v) => [v.ruleId, v.severity])).toEqual([
      ['rain-outdoor', 'error'],
      ['budget-over', 'warning'],
    ]);
    expect(events.map((e) => e.type)).toEqual([
      'agent.started',
      'critique',
      'agent.finished',
    ]);
    const event = events[1].data as RunEventPayloads['critique'];
    expect(event).toEqual({
      round: 0,
      violations: critique.violations,
      final: false,
    });
    expect(events[2].data).toMatchObject({
      agent: 'critic',
      task: 'critique',
      status: 'ok',
      summary: '1 Fehler, 1 Hinweis: Tag 2 nachbessern',
    });
  });

  it('nach der letzten erlaubten Runde bessert niemand mehr nach, Fehler bleiben offen', async () => {
    const { ctx, events } = testContext();

    const critique = await new CriticAgent().run(
      {
        brief: LISBON_BRIEF,
        draft: RAINY,
        findings: FINDINGS,
        budget: BUDGET,
        round: MAX_REPAIRS,
        previous: RAINY,
      },
      ctx,
    );

    expect(critique.repairDays).toEqual([]);
    expect(critique.violations).toHaveLength(2);
    expect(events[1].data).toMatchObject({
      round: MAX_REPAIRS,
      changes: [],
      final: true,
    });
  });

  it('nur Hinweise: fertig ohne Nachbesserung', async () => {
    const { ctx } = testContext();
    const dry = draft([{ dayNumber: 1, title: 'Alfama' }]);

    const critique = await new CriticAgent().run(
      {
        brief: LISBON_BRIEF,
        draft: dry,
        findings: FINDINGS,
        budget: BUDGET,
        round: 0,
      },
      ctx,
    );

    expect(critique.repairDays).toEqual([]);
    expect(critique.violations.map((v) => v.severity)).toEqual(['warning']);
  });

  it('dayChanges: Diff pro Tag, unveränderte Tage fehlen', () => {
    const repaired = draft([
      { dayNumber: 1, order: 1, title: 'Alfama' },
      { dayNumber: 2, order: 1, title: 'Museu Nacional do Azulejo' },
      { dayNumber: 2, order: 2, title: 'Time Out Market', category: 'FOOD' },
      { dayNumber: 3, order: 1, title: 'Gulbenkian' },
    ]);
    expect(dayChanges(RAINY, repaired)).toEqual([
      {
        dayNumber: 2,
        removed: ['Torre de Belém'],
        added: ['Museu Nacional do Azulejo'],
      },
    ]);
  });
});
