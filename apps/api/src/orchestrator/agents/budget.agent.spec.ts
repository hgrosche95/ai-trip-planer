import type { RunEventPayloads, RunEventType } from '../../runs/run-events';
import type { AgentContext } from '../agent.types';
import { emptyFindings } from '../trip-draft';
import type { ResearchFindings, TripBrief, TripDraft } from '../trip-draft';
import {
  BudgetAgent,
  FOOD_PER_DAY_EUR,
  budgetStatus,
  computeBudget,
} from './budget.agent';

function context() {
  const events: { type: RunEventType; data: unknown }[] = [];
  const ctx: AgentContext = {
    runId: 'run-1',
    userId: 'user-a',
    emit: (type, data) => events.push({ type, data }),
    llm: () => {
      throw new Error('Der Budget-Agent darf kein LLM aufrufen');
    },
    signal: new AbortController().signal,
    today: '2026-09-28',
  };
  return { ctx, events };
}

// Lissabon, 3 Tage / 2 Nächte, 1 Person, ab Berlin
const brief: TripBrief = {
  destination: 'Lissabon',
  origin: 'Berlin',
  startDate: '2026-10-14',
  endDate: '2026-10-16',
  datesAssumed: true,
  travelers: 1,
  budget: { amount: 800, currency: 'EUR' },
  preferences: [],
  assumptions: [],
};

const draft: TripDraft = {
  destination: 'Lissabon',
  startDate: brief.startDate,
  endDate: brief.endDate,
  budgetCents: 80_000,
  currency: 'EUR',
  stops: [
    {
      dayNumber: 1,
      order: 1,
      title: 'Flug',
      category: 'TRANSPORT',
      costCents: 30_000,
      lat: 38.7,
      lng: -9.1,
    },
    {
      dayNumber: 1,
      order: 2,
      title: 'Hotel',
      category: 'ACCOMMODATION',
      costCents: 20_000,
      lat: 38.7,
      lng: -9.1,
    },
    {
      dayNumber: 2,
      order: 1,
      title: 'Mosteiro',
      category: 'CULTURE',
      costCents: 1_800,
      lat: 38.7,
      lng: -9.2,
    },
    {
      dayNumber: 3,
      order: 1,
      title: 'Tram 28',
      category: 'SIGHTSEEING',
      costCents: 300,
      lat: 38.71,
      lng: -9.13,
    },
  ],
};

function findings(overrides: Partial<ResearchFindings> = {}): ResearchFindings {
  return {
    ...emptyFindings(),
    destination: { name: 'Lissabon', lat: 38.72, lng: -9.14 },
    transport: {
      straightLineKm: 2300,
      recommended: 'flight',
      options: [
        {
          mode: 'flight',
          distanceKm: 2300,
          priceMinEur: 100,
          priceMaxEur: 200,
          durationHours: 5.6,
          co2Kg: 460,
        },
      ],
    },
    lodging: {
      searchLinks: {
        booking: 'https://www.booking.com/',
        airbnb: 'https://www.airbnb.de/',
      },
      items: [
        {
          name: 'A',
          lat: 0,
          lng: 0,
          kind: 'hotel',
          priceMinEur: 60,
          priceMaxEur: 100,
        },
        {
          name: 'B',
          lat: 0,
          lng: 0,
          kind: 'guest_house',
          priceMinEur: 50,
          priceMaxEur: 90,
        },
        {
          name: 'C',
          lat: 0,
          lng: 0,
          kind: 'hostel',
          priceMinEur: 20,
          priceMaxEur: 40,
        },
      ],
    },
    ...overrides,
  };
}

describe('BudgetAgent', () => {
  it('rechnet die Posten aus Recherche und Entwurf', () => {
    const report = computeBudget({ brief, draft, findings: findings() });

    expect(report.items).toEqual([
      // Mitte 150 € × hin und zurück × 1 Person
      { category: 'transport', cents: 30_000 },
      // Median ohne Hostel: (80 + 70) / 2 = 75 € × 2 Nächte × 1 Zimmer
      { category: 'lodging', cents: 15_000 },
      // Nur Mosteiro und Tram, Flug und Hotel stecken schon oben
      { category: 'activities', cents: 2_100 },
      // 3 Tage × Lissabon Preisniveau 2
      { category: 'food', cents: 3 * FOOD_PER_DAY_EUR[2] * 100 },
    ]);
    expect(report.totalCents).toBe(30_000 + 15_000 + 2_100 + 10_500);
    expect(report.limitCents).toBe(80_000);
  });

  it('meldet ok, wenn deutlich Luft bleibt', () => {
    const report = computeBudget({ brief, draft, findings: findings() });
    // 576 € von 800 €
    expect(report.status).toBe('ok');
  });

  it('meldet tight ab 90 % des Budgets', () => {
    const report = computeBudget({
      brief: { ...brief, budget: { amount: 600, currency: 'EUR' } },
      draft,
      findings: findings(),
    });
    // 576 € von 600 € = 96 %
    expect(report.status).toBe('tight');
  });

  it('meldet over, wenn die Summe das Budget übersteigt', () => {
    const report = computeBudget({
      brief: { ...brief, travelers: 2 },
      draft,
      findings: findings(),
    });
    // 2 Personen: Anreise 600 €, 1 Zimmer 150 €, Programm 42 €, Essen 210 €
    expect(report.totalCents).toBe(60_000 + 15_000 + 4_200 + 21_000);
    expect(report.status).toBe('over');
  });

  it('nimmt ohne Unterkünfte das Preisniveau der Stadt und lässt die Anreise ohne Abreiseort weg', () => {
    const report = computeBudget({
      brief: { ...brief, origin: undefined },
      draft,
      findings: findings({ transport: undefined, lodging: undefined }),
    });
    expect(report.items.map((item) => item.category)).toEqual([
      'lodging',
      'activities',
      'food',
    ]);
    // Lissabon 75–140 € → 107,50 € × 2 Nächte
    expect(report.items[0].cents).toBe(21_500);
  });

  it('ohne Budget ist der Status ok und das Limit null', () => {
    const report = computeBudget({
      brief: { ...brief, budget: undefined },
      draft,
      findings: findings(),
    });
    expect(report.limitCents).toBeNull();
    expect(report.status).toBe('ok');
  });

  it('nutzt ein umgerechnetes Budget in fremder Währung, rät aber keinen Kurs', () => {
    const foreign = { ...brief, budget: { amount: 3500, currency: 'PLN' } };
    expect(
      computeBudget({
        brief: foreign,
        draft,
        findings: findings({ budgetEurCents: 81_000 }),
      }).limitCents,
    ).toBe(81_000);
    expect(
      computeBudget({ brief: foreign, draft, findings: findings() }).limitCents,
    ).toBeNull();
  });

  it('budgetStatus an den Grenzen', () => {
    expect(budgetStatus(90_000, 100_000)).toBe('ok');
    expect(budgetStatus(90_001, 100_000)).toBe('tight');
    expect(budgetStatus(100_000, 100_000)).toBe('tight');
    expect(budgetStatus(100_001, 100_000)).toBe('over');
    expect(budgetStatus(5, null)).toBe('ok');
  });

  it('meldet budget.updated in einem Agenten-Schritt, ohne LLM', async () => {
    const { ctx, events } = context();

    const report = await new BudgetAgent().run(
      { brief, draft, findings: findings() },
      ctx,
    );

    expect(events.map((event) => event.type)).toEqual([
      'agent.started',
      'budget.updated',
      'agent.finished',
    ]);
    expect(events[1].data).toEqual(report);
    const finished = events[2].data as RunEventPayloads['agent.finished'];
    expect(finished).toMatchObject({
      agent: 'budget',
      task: 'budget',
      status: 'ok',
      summary: '576 € von 800 €, im Rahmen',
    });
  });

  describe('Unterkunftsniveau', () => {
    const lodging = (report: ReturnType<typeof computeBudget>) =>
      report.items.find((item) => item.category === 'lodging')?.cents;

    it('ohne Angabe: Median der Mitten ohne Hostels (75 € × 2 Nächte)', () => {
      expect(
        lodging(computeBudget({ brief, draft, findings: findings() })),
      ).toBe(15_000);
    });

    it('"günstig": Median der unteren Enden unter der Preisgrenze (55 € × 2)', () => {
      const report = computeBudget({
        brief: { ...brief, lodging: 'budget' },
        draft,
        findings: findings(),
      });
      expect(lodging(report)).toBe(11_000);
    });

    it('"günstig" ohne passende Unterkunft: die Preisgrenze (60 € × 2)', () => {
      const report = computeBudget({
        brief: { ...brief, lodging: 'budget' },
        draft,
        findings: findings({ lodging: undefined }),
      });
      expect(lodging(report)).toBe(12_000);
    });

    it('"gehoben": Median der oberen Enden (95 € × 2)', () => {
      const report = computeBudget({
        brief: { ...brief, lodging: 'upscale' },
        draft,
        findings: findings(),
      });
      expect(lodging(report)).toBe(19_000);
    });
  });
});
