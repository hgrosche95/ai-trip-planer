import type { LlmChatResult } from '../../llm/llm-provider.interface';
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

describe('CriticAgent: Vorlieben per KI', () => {
  const VEGGIE_BRIEF = { ...LISBON_BRIEF, preferences: ['vegetarisch'] };
  const STEAK = draft([
    { dayNumber: 1, order: 1, title: 'Alfama' },
    {
      dayNumber: 2,
      order: 1,
      title: 'Churrasqueira do Campo',
      category: 'FOOD',
    },
    { dayNumber: 3, order: 1, title: 'Gulbenkian' },
  ]);
  const DRY: ResearchFindings = { ...FINDINGS, weather: undefined };
  const OK_BUDGET: BudgetReport = {
    ...BUDGET,
    totalCents: 50_000,
    status: 'ok',
  };

  function llmReplying(content: string) {
    const chat = jest.fn((): Promise<LlmChatResult> =>
      Promise.resolve({
        content,
        toolCalls: [],
        finishReason: 'stop',
        usage: { inputTokens: 400, outputTokens: 80 },
        model: 'openai/gpt-oss-120b',
      }),
    );
    return { chat, llm: () => ({ chat }) };
  }

  afterEach(() => {
    delete process.env.CRITIC_PREFERENCE_CHECK;
  });

  it('meldet einen Widerspruch zur Vorliebe als Fehler am Programmpunkt, 1 KI-Aufruf', async () => {
    const { chat, llm } = llmReplying(
      '{"issues":[{"dayNumber":2,"stopTitle":"Churrasqueira do Campo","message":"Grillhaus mit Fleisch, passt nicht zu vegetarisch"}]}',
    );
    const { ctx, events } = testContext(llm);

    const critique = await new CriticAgent().run(
      {
        brief: VEGGIE_BRIEF,
        draft: STEAK,
        findings: DRY,
        budget: OK_BUDGET,
        round: 0,
      },
      ctx,
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(critique.repairDays).toEqual([2]);
    expect(critique.preferenceIssues).toEqual([
      {
        ruleId: 'preference',
        severity: 'error',
        dayNumber: 2,
        stopTitle: 'Churrasqueira do Campo',
        lat: 38.71,
        lng: -9.13,
        message:
          'Churrasqueira do Campo: Grillhaus mit Fleisch, passt nicht zu vegetarisch',
      },
    ]);
    // Der KI-Aufruf gehört in die Lane des Kritikers
    expect(events.map((e) => e.type)).toEqual([
      'agent.started',
      'llm.started',
      'llm.call',
      'critique',
      'agent.finished',
    ]);
    expect(events[2].data).toMatchObject({ agent: 'critic' });
    // Die Fakten: Vorlieben und Programm, ohne An- und Abreise
    const facts = JSON.parse(
      (chat.mock.calls[0] as unknown as [{ content: string }[]])[0][1].content,
    ) as { Vorlieben: string[]; Tage: Record<string, unknown[]> };
    expect(facts.Vorlieben).toEqual(['vegetarisch']);
    expect(Object.keys(facts.Tage)).toEqual(['1', '2', '3']);
  });

  it('verwirft Meldungen zu Punkten, die es an dem Tag nicht gibt, und leere Antworten', async () => {
    const { llm } = llmReplying(
      '{"issues":[{"dayNumber":1,"stopTitle":"Churrasqueira do Campo","message":"falscher Tag"},{"dayNumber":2,"stopTitle":"Erfundenes Lokal","message":"gibt es nicht"},{"dayNumber":2,"stopTitle":"churrasqueira do campo","message":""}]}',
    );
    const { ctx } = testContext(llm);

    const critique = await new CriticAgent().run(
      {
        brief: VEGGIE_BRIEF,
        draft: STEAK,
        findings: DRY,
        budget: OK_BUDGET,
        round: 0,
      },
      ctx,
    );

    expect(critique.violations).toEqual([]);
  });

  it('ohne Vorlieben oder mit CRITIC_PREFERENCE_CHECK=off: kein KI-Aufruf', async () => {
    const { chat, llm } = llmReplying('{"issues":[]}');
    const { ctx } = testContext(llm);
    const critic = new CriticAgent();

    await critic.run(
      {
        brief: LISBON_BRIEF,
        draft: STEAK,
        findings: DRY,
        budget: OK_BUDGET,
        round: 0,
      },
      ctx,
    );
    process.env.CRITIC_PREFERENCE_CHECK = 'off';
    await critic.run(
      {
        brief: VEGGIE_BRIEF,
        draft: STEAK,
        findings: DRY,
        budget: OK_BUDGET,
        round: 0,
      },
      ctx,
    );

    expect(chat).not.toHaveBeenCalled();
  });

  it('scheitert der KI-Aufruf, gilt der Plan ohne diese Prüfung', async () => {
    const chat = jest.fn((): Promise<LlmChatResult> =>
      Promise.reject(new Error('503')),
    );
    const { ctx } = testContext(() => ({ chat }));

    const critique = await new CriticAgent().run(
      {
        brief: VEGGIE_BRIEF,
        draft: STEAK,
        findings: DRY,
        budget: OK_BUDGET,
        round: 0,
      },
      ctx,
    );

    expect(critique.violations).toEqual([]);
  });

  it('nach einer Nachbesserung prüft Code statt KI: offen, solange der Punkt noch da ist', async () => {
    const { chat, llm } = llmReplying('{"issues":[]}');
    const { ctx } = testContext(llm);
    const issue = {
      ruleId: 'preference',
      severity: 'error' as const,
      dayNumber: 2,
      stopTitle: 'Churrasqueira do Campo',
      message: 'Churrasqueira do Campo: passt nicht zu vegetarisch',
    };
    const critic = new CriticAgent();
    const base = {
      brief: VEGGIE_BRIEF,
      findings: DRY,
      budget: OK_BUDGET,
      preferenceIssues: [issue],
    };

    const stubborn = await critic.run({ ...base, draft: STEAK, round: 1 }, ctx);
    const fixed = await critic.run(
      {
        ...base,
        draft: draft([
          { dayNumber: 1, order: 1, title: 'Alfama' },
          { dayNumber: 2, order: 1, title: 'Ai Mouraria', category: 'FOOD' },
          { dayNumber: 3, order: 1, title: 'Gulbenkian' },
        ]),
        round: 1,
      },
      ctx,
    );

    expect(chat).not.toHaveBeenCalled();
    expect(stubborn.violations).toEqual([issue]);
    expect(stubborn.repairDays).toEqual([2]);
    expect(fixed.violations).toEqual([]);
  });
});
