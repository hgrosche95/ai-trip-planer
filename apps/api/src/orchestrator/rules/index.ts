import { budgetOverRule } from './budget-over.rule';
import { dayLoadRule } from './day-load.rule';
import { duplicateStopRule } from './duplicate-stop.rule';
import { farAwayRule } from './far-away.rule';
import { holidayRule } from './holiday.rule';
import { rainOutdoorRule } from './rain-outdoor.rule';
import type { Rule, RuleInput, Violation } from './rule.types';

export type { Rule, RuleInput, Violation } from './rule.types';

// Die Regel-Registry des Kritikers. Eine neue Regel ist eine Datei
// *.rule.ts mit einer reinen Funktion und ein Eintrag hier.
export const RULES: Rule[] = [
  rainOutdoorRule,
  duplicateStopRule,
  farAwayRule,
  dayLoadRule,
  holidayRule,
  budgetOverRule,
];

// Alle Befunde, Fehler zuerst, dann nach Tag
export function checkRules(
  input: RuleInput,
  rules: Rule[] = RULES,
): Violation[] {
  const severityRank = { error: 0, warning: 1 };
  return rules
    .flatMap((rule) => rule.check(input))
    .sort(
      (a, b) =>
        severityRank[a.severity] - severityRank[b.severity] ||
        (a.dayNumber ?? 0) - (b.dayNumber ?? 0),
    );
}
