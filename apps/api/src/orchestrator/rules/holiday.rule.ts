import type { DraftStop } from '../trip-draft';
import { dateOfDay, stopRef } from './rule.types';
import type { Rule } from './rule.types';

// Innenräume mit Öffnungszeiten: Kultur-Stops und alles, was nach Museum,
// Galerie oder Palast klingt
const OPENING_HOURS_WORDS =
  /\b(museu\w*|museo|musée|galerie\w*|gallery|galleria|palast|palácio|palacio|palais|palazzo|schloss|castelo|castillo|kloster|mosteiro)\b/i;

function hasOpeningHours(stop: DraftStop): boolean {
  return (
    stop.category === 'CULTURE' ||
    OPENING_HOURS_WORDS.test(`${stop.title} ${stop.description ?? ''}`)
  );
}

// Museum oder Palast an einem gesetzlichen Feiertag (Nager.Date). Nur ein
// Hinweis: Viele Häuser haben trotzdem offen, manche gerade dann. Die
// Antwort rät, die Öffnungszeiten zu prüfen, statt den Plan umzuwerfen.
export const holidayRule: Rule = {
  id: 'holiday',
  description:
    'Programm mit Öffnungszeiten an einem Feiertag wird als Hinweis genannt',
  check({ draft, findings }) {
    const holidays = new Map(
      (findings.holidays ?? []).map(({ date, name }) => [date, name]),
    );
    if (holidays.size === 0) return [];
    return draft.stops.filter(hasOpeningHours).flatMap((stop) => {
      const name = holidays.get(dateOfDay(draft.startDate, stop.dayNumber));
      if (name === undefined) return [];
      return [
        {
          ruleId: 'holiday',
          severity: 'warning' as const,
          ...stopRef(stop),
          message: `Tag ${stop.dayNumber} ist Feiertag (${name}): Öffnungszeiten von ${stop.title} prüfen`,
        },
      ];
    });
  },
};
