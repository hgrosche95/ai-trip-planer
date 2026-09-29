import { isProgram } from './rule.types';
import type { Rule } from './rule.types';

// Mehr Programm an einem Tag ist kaum zu schaffen (Anreise, Abreise und
// Unterkunft zählen nicht mit)
export const MAX_PROGRAM_PER_DAY = 4;

export const dayLoadRule: Rule = {
  id: 'day-load',
  description: `Höchstens ${MAX_PROGRAM_PER_DAY} Programmpunkte pro Tag`,
  check({ draft }) {
    const perDay = new Map<number, number>();
    for (const stop of draft.stops.filter(isProgram)) {
      perDay.set(stop.dayNumber, (perDay.get(stop.dayNumber) ?? 0) + 1);
    }
    return [...perDay]
      .filter(([, count]) => count > MAX_PROGRAM_PER_DAY)
      .sort(([a], [b]) => a - b)
      .map(([dayNumber, count]) => ({
        ruleId: 'day-load',
        severity: 'warning' as const,
        dayNumber,
        message: `Tag ${dayNumber} ist mit ${count} Programmpunkten sehr voll`,
      }));
  },
};
