import type { BudgetItem, RunEventPayloads } from '../../runs/run-events';
import { priceLevelFor } from '../../tools/lodging.tool';
import { agentStep } from '../agent.types';
import { formatEur } from '../rules/format';
import { lodgingNightCapEur } from '../draft-revision';
import type { Agent, AgentContext } from '../agent.types';
import { tripDays, tripNights } from '../trip-draft';
import type { ResearchFindings, TripBrief, TripDraft } from '../trip-draft';

export type BudgetReport = RunEventPayloads['budget.updated'];
export { formatEur };

export interface BudgetInput {
  brief: TripBrief;
  draft: TripDraft;
  findings: ResearchFindings;
}

// Der Budget-Agent rechnet in Phase 3a ausschließlich in Code: keine
// Tokens, deterministisch testbar, und die Evals können dieselbe Summe
// unabhängig nachrechnen. Sparvorschläge per LLM bei "over" folgen in 3b.
//
// Alle Beträge sind Mittelwerte der geschätzten Spannen aus der Recherche,
// also selbst Schätzungen. Die Posten:
//   Anreise    = Mitte der empfohlenen Option × 2 (hin und zurück) × Personen
//   Unterkunft = Nächte × Preis pro Nacht × Zimmer (2 Personen pro Zimmer),
//                Preis nach Unterkunftsniveau (siehe nightlyEur)
//   Programm   = Summe costCents der Programmpunkte × Personen (ohne
//                Anreise- und Unterkunftspunkte, die stecken schon oben)
//   Essen      = Tage × Personen × Tagespauschale nach Preisniveau der Stadt

// Tagespauschale Essen und Trinken pro Person nach Preisniveau (1–4) der
// Stadt (lodging.tool.ts): Frühstück im Café, ein einfaches und ein
// Restaurant-Essen, Getränke.
export const FOOD_PER_DAY_EUR: Record<1 | 2 | 3 | 4, number> = {
  1: 25,
  2: 35,
  3: 45,
  4: 60,
};
// Ab diesem Anteil am Budget ist es "knapp": Die Schätzungen sind grob,
// 10 % Luft fangen eine teurere Unterkunft oder einen Abend mehr auswärts.
export const TIGHT_SHARE = 0.9;
const PERSONS_PER_ROOM = 2;

export class BudgetAgent implements Agent<BudgetInput, BudgetReport> {
  readonly name = 'budget' as const;

  run(input: BudgetInput, ctx: AgentContext): Promise<BudgetReport> {
    return agentStep(ctx, this.name, 'budget', () => {
      const report = computeBudget(input);
      ctx.emit('budget.updated', report);
      return Promise.resolve({ value: report, summary: budgetSummary(report) });
    });
  }
}

export function computeBudget({
  brief,
  draft,
  findings,
}: BudgetInput): BudgetReport {
  const { level, hotelNightEur } = priceLevelFor(
    findings.destination?.name ?? brief.destination,
    brief.destination,
  ).level;
  const travelers = brief.travelers;
  const items: BudgetItem[] = [];

  const transport = findings.transport?.options.find(
    (option) => option.mode === findings.transport?.recommended,
  );
  if (transport) {
    items.push({
      category: 'transport',
      cents: euroCents(
        mid(transport.priceMinEur, transport.priceMaxEur) * 2 * travelers,
      ),
    });
  }

  const nights = tripNights(brief);
  if (nights > 0) {
    const rooms = Math.ceil(travelers / PERSONS_PER_ROOM);
    items.push({
      category: 'lodging',
      cents: euroCents(
        nights * nightlyEur(findings, hotelNightEur, brief) * rooms,
      ),
    });
  }

  const activityCents = draft.stops
    .filter(
      (stop) =>
        stop.category !== 'TRANSPORT' && stop.category !== 'ACCOMMODATION',
    )
    .reduce((sum, stop) => sum + (stop.costCents ?? 0), 0);
  items.push({ category: 'activities', cents: activityCents * travelers });

  items.push({
    category: 'food',
    cents: euroCents(tripDays(brief) * travelers * FOOD_PER_DAY_EUR[level]),
  });

  const totalCents = items.reduce((sum, item) => sum + item.cents, 0);
  const limitCents = budgetLimitCents(brief, findings);
  return {
    currency: 'EUR',
    limitCents,
    totalCents,
    status: budgetStatus(totalCents, limitCents),
    items,
  };
}

export function budgetStatus(
  totalCents: number,
  limitCents: number | null,
): BudgetReport['status'] {
  if (limitCents === null) return 'ok';
  if (totalCents > limitCents) return 'over';
  if (totalCents > limitCents * TIGHT_SHARE) return 'tight';
  return 'ok';
}

// Budget in Euro-Cent. Eine andere Währung zählt nur, wenn die Recherche
// sie mit dem EZB-Kurs umgerechnet hat; geraten wird kein Kurs.
function budgetLimitCents(
  brief: TripBrief,
  findings: ResearchFindings,
): number | null {
  if (!brief.budget) return null;
  if (brief.budget.currency === 'EUR') return euroCents(brief.budget.amount);
  return findings.budgetEurCents ?? null;
}

// Preis pro Nacht und Zimmer. Ohne Angabe oder Mittelklasse: Median der
// Mitten der gefundenen Unterkünfte ohne Hostels (die sind pro Bett), sonst
// das Preisniveau der Stadt. "günstig": Median der unteren Enden der
// Unterkünfte unter der Preisgrenze. "gehoben": Median der oberen Enden.
function nightlyEur(
  findings: ResearchFindings,
  cityRange: [number, number],
  brief: Pick<TripBrief, 'destination' | 'lodging'>,
): number {
  const rooms = (findings.lodging?.items ?? []).filter(
    (item) => item.kind !== 'hostel',
  );
  if (brief.lodging === 'budget') {
    const cap = lodgingNightCapEur(brief) ?? cityRange[0];
    const cheap = rooms
      .filter((item) => item.priceMinEur <= cap)
      .map((item) => item.priceMinEur);
    return cheap.length > 0 ? median(cheap) : cap;
  }
  if (brief.lodging === 'upscale') {
    return rooms.length > 0
      ? median(rooms.map((item) => item.priceMaxEur))
      : cityRange[1];
  }
  if (rooms.length === 0) return mid(cityRange[0], cityRange[1]);
  return median(rooms.map((item) => mid(item.priceMinEur, item.priceMaxEur)));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : mid(sorted[middle - 1], sorted[middle]);
}

function budgetSummary(report: BudgetReport): string {
  const total = formatEur(report.totalCents);
  if (report.limitCents === null) return `${total}, kein Budget genannt`;
  const labels = { ok: 'im Rahmen', tight: 'knapp', over: 'überschritten' };
  return `${total} von ${formatEur(report.limitCents)}, ${labels[report.status]}`;
}

function mid(min: number, max: number): number {
  return (min + max) / 2;
}

function euroCents(eur: number): number {
  return Math.round(eur * 100);
}
