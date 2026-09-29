import { formatEur } from './format';
import type { Rule } from './rule.types';

// Die Schätzung liegt über dem genannten Budget. Nur ein Hinweis: Den
// größten Teil machen Anreise und Unterkunft aus, das kann der Planer mit
// einem anderen Programm nicht retten. Die Antwort sagt es offen.
export const budgetOverRule: Rule = {
  id: 'budget-over',
  description: 'Die geschätzten Kosten liegen im genannten Budget',
  check({ budget }) {
    if (budget.status !== 'over' || budget.limitCents === null) return [];
    return [
      {
        ruleId: 'budget-over',
        severity: 'warning' as const,
        message: `Geschätzt ${formatEur(budget.totalCents)}, ${formatEur(budget.totalCents - budget.limitCents)} über dem Budget von ${formatEur(budget.limitCents)}`,
      },
    ];
  },
};
