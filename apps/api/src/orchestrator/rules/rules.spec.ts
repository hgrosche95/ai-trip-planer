import type { BudgetReport } from '../agents/budget.agent';
import { LISBON_BRIEF } from '../testing.fixtures';
import type { DraftStop, ResearchFindings, TripDraft } from '../trip-draft';
import { budgetOverRule } from './budget-over.rule';
import { dayLoadRule } from './day-load.rule';
import { duplicateStopRule } from './duplicate-stop.rule';
import { farAwayRule } from './far-away.rule';
import { RULES, checkRules } from './index';
import { isOutdoor, rainOutdoorRule } from './rain-outdoor.rule';
import type { RuleInput, Violation } from './rule.types';

const LISBON = { name: 'Lissabon', lat: 38.72, lng: -9.14 };

function stop(
  dayNumber: number,
  order: number,
  title: string,
  extra: Partial<DraftStop> = {},
): DraftStop {
  return {
    dayNumber,
    order,
    title,
    category: 'SIGHTSEEING',
    lat: 38.71,
    lng: -9.13,
    ...extra,
  };
}

// Ein Entwurf ohne Befunde: Regen an Tag 2, dort nur drinnen
const CLEAN_STOPS: DraftStop[] = [
  stop(1, 1, 'Ankunft', { category: 'TRANSPORT', lat: 52.52, lng: 13.4 }),
  stop(1, 2, 'Alfama und Tram 28'),
  stop(2, 1, 'Museu Nacional do Azulejo', { category: 'CULTURE' }),
  stop(2, 2, 'Time Out Market', { category: 'FOOD' }),
  stop(3, 1, 'Jardim da Estrela'),
  stop(3, 2, 'Abreise', { category: 'TRANSPORT' }),
];

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
        precipMm: 2,
        code: 61,
        label: 'leichter Regen',
      },
    ],
  },
  knowledge: [],
  sources: [],
  searchAttempted: false,
};

const BUDGET_OK: BudgetReport = {
  currency: 'EUR',
  limitCents: 80_000,
  totalCents: 60_000,
  status: 'ok',
  items: [],
};

function input(
  stops: DraftStop[] = CLEAN_STOPS,
  overrides: Partial<RuleInput> = {},
): RuleInput {
  const draft: TripDraft = {
    destination: 'Lissabon',
    startDate: '2026-10-14',
    endDate: '2026-10-16',
    budgetCents: 80_000,
    currency: 'EUR',
    preferences: [],
    stops,
  };
  return {
    brief: LISBON_BRIEF,
    draft,
    findings: FINDINGS,
    budget: BUDGET_OK,
    ...overrides,
  };
}

function replace(day: number, order: number, next: DraftStop): DraftStop[] {
  return CLEAN_STOPS.map((s) =>
    s.dayNumber === day && s.order === order ? next : s,
  );
}

describe('Regeln des Kritikers', () => {
  it('ein sauberer Entwurf hat keine Befunde', () => {
    expect(checkRules(input())).toEqual([]);
  });

  describe('rain-outdoor', () => {
    it('meldet Programm draußen an einem Regentag, mit Ort für den Globus', () => {
      const violations = rainOutdoorRule.check(
        input(
          replace(
            2,
            1,
            stop(2, 1, 'Torre de Belém', {
              outdoor: true,
              lat: 38.69,
              lng: -9.21,
            }),
          ),
        ),
      );
      expect(violations).toEqual([
        {
          ruleId: 'rain-outdoor',
          severity: 'error',
          dayNumber: 2,
          stopTitle: 'Torre de Belém',
          lat: 38.69,
          lng: -9.21,
          message: 'Torre de Belém liegt draußen, an Tag 2 regnet es (14 mm)',
        },
      ]);
    });

    it('erkennt draußen am Titel, wenn das Modell outdoor nicht setzt', () => {
      const violations = rainOutdoorRule.check(
        input(replace(2, 1, stop(2, 1, 'Miradouro da Senhora do Monte'))),
      );
      expect(violations).toHaveLength(1);
    });

    it('nennt Vorjahreswerte als solche', () => {
      const [violation] = rainOutdoorRule.check(
        input(replace(2, 1, stop(2, 1, 'Parque Eduardo VII')), {
          findings: {
            ...FINDINGS,
            weather: { ...FINDINGS.weather!, source: 'climate' },
          },
        }),
      );
      expect(violation.message).toMatch(/\(14 mm, Vorjahreswert\)$/);
    });

    it('lässt leichten Regen, drinnen, outdoor:false und fehlendes Wetter durch', () => {
      // Tag 3: 2 mm, unter der Grenze
      expect(rainOutdoorRule.check(input())).toEqual([]);
      // Das Modell sagt ausdrücklich drinnen, auch wenn "Garten" im Titel steht
      expect(
        rainOutdoorRule.check(
          input(
            replace(2, 1, stop(2, 1, 'Wintergarten-Café', { outdoor: false })),
          ),
        ),
      ).toEqual([]);
      expect(
        rainOutdoorRule.check(
          input(replace(2, 1, stop(2, 1, 'Parque Eduardo VII')), {
            findings: { ...FINDINGS, weather: undefined },
          }),
        ),
      ).toEqual([]);
    });

    it('Anreise und Unterkunft zählen nie als draußen', () => {
      expect(
        isOutdoor(
          stop(1, 1, 'Spaziergang zum Hotel', { category: 'TRANSPORT' }),
        ),
      ).toBe(false);
      expect(isOutdoor(stop(1, 1, 'Spaziergang an der Promenade'))).toBe(true);
    });
  });

  describe('duplicate-stop', () => {
    it('meldet die Wiederholung am späteren Tag, nicht das erste Vorkommen', () => {
      const violations = duplicateStopRule.check(
        input(replace(3, 1, stop(3, 1, 'alfama und Tram 28!'))),
      );
      expect(violations).toEqual([
        expect.objectContaining({
          ruleId: 'duplicate-stop',
          severity: 'error',
          dayNumber: 3,
          message: 'alfama und Tram 28! steht schon an Tag 1',
        }),
      ]);
    });

    it('Anreise und Abreise dürfen gleich heißen', () => {
      expect(
        duplicateStopRule.check(
          input(
            replace(3, 2, stop(3, 2, 'Ankunft', { category: 'TRANSPORT' })),
          ),
        ),
      ).toEqual([]);
    });
  });

  describe('far-away', () => {
    it('mehr als 150 km vom Ziel ist ein Fehler (Koordinaten falsch)', () => {
      const violations = farAwayRule.check(
        input(
          replace(
            2,
            1,
            stop(2, 1, 'Prado', {
              category: 'CULTURE',
              lat: 40.41,
              lng: -3.69,
            }),
          ),
        ),
      );
      expect(violations.map((v) => [v.stopTitle, v.severity])).toEqual([
        ['Prado', 'error'],
      ]);
      expect(violations[0].message).toMatch(
        /^Prado liegt \d+ km von Lissabon entfernt/,
      );
    });

    it('ein Ausflug (30–150 km) ist nur ein Hinweis', () => {
      const violations = farAwayRule.check(
        input(
          replace(3, 1, stop(3, 1, 'Cabo da Roca', { lat: 38.78, lng: -9.5 })),
        ),
      );
      expect(violations.map((v) => v.severity)).toEqual(['warning']);
      expect(violations[0].message).toMatch(
        /^Cabo da Roca ist ein Ausflug: \d+ km von Lissabon$/,
      );
    });

    it('Anreise vom Abreiseort und Entwürfe ohne geokodiertes Ziel bleiben unbeanstandet', () => {
      // Die Ankunft in CLEAN_STOPS liegt in Berlin
      expect(farAwayRule.check(input())).toEqual([]);
      expect(
        farAwayRule.check(
          input(
            replace(2, 1, stop(2, 1, 'Prado', { lat: 40.41, lng: -3.69 })),
            {
              findings: { ...FINDINGS, destination: undefined },
            },
          ),
        ),
      ).toEqual([]);
    });
  });

  describe('day-load', () => {
    it('mehr als 4 Programmpunkte an einem Tag sind ein Hinweis', () => {
      const full = [
        ...CLEAN_STOPS,
        ...[3, 4, 5, 6].map((order) => stop(1, order, `Punkt ${order}`)),
      ];
      expect(dayLoadRule.check(input(full))).toEqual([
        {
          ruleId: 'day-load',
          severity: 'warning',
          dayNumber: 1,
          message: 'Tag 1 ist mit 5 Programmpunkten sehr voll',
        },
      ]);
    });

    it('4 Programmpunkte plus An- und Abreise sind in Ordnung', () => {
      const four = [
        ...CLEAN_STOPS,
        ...[3, 4, 5].map((order) => stop(1, order, `Punkt ${order}`)),
      ].filter((s) => s.title !== 'Alfama und Tram 28');
      expect(dayLoadRule.check(input(four))).toEqual([]);
    });
  });

  describe('budget-over', () => {
    it('meldet die Überschreitung mit Beträgen, nur als Hinweis', () => {
      expect(
        budgetOverRule.check(
          input(CLEAN_STOPS, {
            budget: { ...BUDGET_OK, totalCents: 95_000, status: 'over' },
          }),
        ),
      ).toEqual([
        {
          ruleId: 'budget-over',
          severity: 'warning',
          message: 'Geschätzt 950 €, 150 € über dem Budget von 800 €',
        },
      ]);
    });

    it('knapp, im Rahmen oder ohne Budget: kein Befund', () => {
      for (const budget of [
        { ...BUDGET_OK, status: 'tight' as const },
        BUDGET_OK,
        { ...BUDGET_OK, limitCents: null, status: 'ok' as const },
      ]) {
        expect(budgetOverRule.check(input(CLEAN_STOPS, { budget }))).toEqual(
          [],
        );
      }
    });
  });

  it('checkRules sortiert Fehler vor Hinweisen, dann nach Tag', () => {
    const stops = [
      ...replace(2, 1, stop(2, 1, 'Parque Eduardo VII')),
      stop(3, 3, 'Alfama und Tram 28'),
    ];
    const violations = checkRules(
      input(stops, {
        budget: { ...BUDGET_OK, totalCents: 90_000, status: 'over' },
      }),
    );
    expect(violations.map((v) => [v.ruleId, v.severity, v.dayNumber])).toEqual([
      ['rain-outdoor', 'error', 2],
      ['duplicate-stop', 'error', 3],
      ['budget-over', 'warning', undefined],
    ]);
  });
});

// Kritiker-Fixtures (Plan 5.2): absichtlich fehlerhafte Entwürfe mit
// bekannter Fehlerliste. Recall = gefundene / erwartete, Precision =
// korrekte / gemeldete Befunde, beides über alle Fixtures.
describe('Kritiker-Fixtures: Recall und Precision der harten Regeln', () => {
  const FIXTURES: { name: string; input: RuleInput; expected: string[] }[] = [
    { name: 'sauber', input: input(), expected: [] },
    {
      name: 'Belém-Turm am Regentag',
      input: input(
        replace(2, 1, stop(2, 1, 'Torre de Belém', { outdoor: true })),
      ),
      expected: ['rain-outdoor@2'],
    },
    {
      name: 'Aussichtspunkt ohne outdoor-Angabe am Regentag',
      input: input(replace(2, 2, stop(2, 2, 'Miradouro de Santa Luzia'))),
      expected: ['rain-outdoor@2'],
    },
    {
      name: 'doppelter Programmpunkt',
      input: input(
        replace(
          3,
          1,
          stop(3, 1, 'Museu Nacional do Azulejo', { category: 'CULTURE' }),
        ),
      ),
      expected: ['duplicate-stop@3'],
    },
    {
      name: 'Koordinaten in Madrid',
      input: input(
        replace(1, 2, stop(1, 2, 'Alfama', { lat: 40.41, lng: -3.69 })),
      ),
      expected: ['far-away@1'],
    },
    {
      name: 'Regen und Dublette zugleich',
      input: input([
        ...replace(2, 1, stop(2, 1, 'Jardim Botânico')),
        stop(3, 3, 'Time Out Market', { category: 'FOOD' }),
      ]),
      expected: ['rain-outdoor@2', 'duplicate-stop@3'],
    },
    {
      name: 'Regen mit Café im Wintergarten (drinnen)',
      input: input(
        replace(2, 1, stop(2, 1, 'Café im Wintergarten', { outdoor: false })),
      ),
      expected: [],
    },
  ];

  const key = (v: Violation) => `${v.ruleId}@${v.dayNumber ?? '-'}`;

  it('Recall und Precision ≥ 90 % bei harten Fehlern', () => {
    let expectedTotal = 0;
    let found = 0;
    let reported = 0;
    let correct = 0;
    for (const fixture of FIXTURES) {
      const errors = checkRules(fixture.input, RULES)
        .filter((v) => v.severity === 'error')
        .map(key);
      expectedTotal += fixture.expected.length;
      found += fixture.expected.filter((e) => errors.includes(e)).length;
      reported += errors.length;
      correct += errors.filter((e) => fixture.expected.includes(e)).length;
    }
    const recall = found / expectedTotal;
    const precision = correct / reported;
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(precision).toBeGreaterThanOrEqual(0.9);
  });
});
