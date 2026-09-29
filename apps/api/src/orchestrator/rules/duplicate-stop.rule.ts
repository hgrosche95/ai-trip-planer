import { isProgram, normalizeTitle, stopRef } from './rule.types';
import type { Rule } from './rule.types';

// Derselbe Programmpunkt zweimal in einer Reise. Gemeldet wird jede
// Wiederholung, nicht das erste Vorkommen: Nachgebessert wird der spätere Tag.
export const duplicateStopRule: Rule = {
  id: 'duplicate-stop',
  description: 'Kein Programmpunkt kommt zweimal vor',
  check({ draft }) {
    const seen = new Map<string, number>();
    const stops = [...draft.stops].sort(
      (a, b) => a.dayNumber - b.dayNumber || a.order - b.order,
    );
    return stops.filter(isProgram).flatMap((stop) => {
      const key = normalizeTitle(stop.title);
      if (key === '') return [];
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, stop.dayNumber);
        return [];
      }
      return [
        {
          ruleId: 'duplicate-stop',
          severity: 'error' as const,
          ...stopRef(stop),
          message:
            first === stop.dayNumber
              ? `${stop.title} steht an Tag ${stop.dayNumber} doppelt`
              : `${stop.title} steht schon an Tag ${first}`,
        },
      ];
    });
  },
};
