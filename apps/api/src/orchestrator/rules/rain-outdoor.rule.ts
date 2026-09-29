import type { DraftStop } from '../trip-draft';
import { dateOfDay, isProgram, stopRef } from './rule.types';
import type { Rule } from './rule.types';

// Ab dieser Regenmenge pro Tag gehört kein Programmpunkt nach draußen
export const RAIN_MM = 5;

// Sagt das Modell nichts zu outdoor, entscheidet der Titel. Bewusst eine
// kurze Liste eindeutiger Wörter: Ein falscher Treffer kostet eine
// Nachbesserung (1 LLM-Aufruf), ein verpasster nur einen nassen Nachmittag.
const OUTDOOR_WORDS =
  /\b(park|parque|garten|gärten|garden|jardim|jardin|strand|beach|praia|playa|aussicht\w*|miradouro|viewpoint|mirador|wanderung|wandern|hike|spaziergang|promenade|bootstour|bootsfahrt|boat|radtour|fahrradtour|zoo|klippe\w*|cabo|seilbahn|picknick|picnic|open.?air|freiluft)\b/i;

export function isOutdoor(stop: DraftStop): boolean {
  if (!isProgram(stop)) return false;
  if (stop.outdoor !== undefined) return stop.outdoor;
  return OUTDOOR_WORDS.test(`${stop.title} ${stop.description ?? ''}`);
}

// Programm draußen an einem Regentag (Wetter aus der Recherche). Bei
// Vorjahreswerten (source climate) gilt dieselbe Grenze: Der Planer hat mit
// denselben Zahlen geplant, und die Antwort sagt, dass es keine Vorhersage
// ist.
export const rainOutdoorRule: Rule = {
  id: 'rain-outdoor',
  description: `Kein Programm draußen an Tagen mit mindestens ${RAIN_MM} mm Regen`,
  check({ draft, findings }) {
    const weather = findings.weather;
    if (!weather) return [];
    const rain = new Map(
      weather.days
        .filter((day) => day.precipMm >= RAIN_MM)
        .map((day) => [day.date, day.precipMm]),
    );
    const note = weather.source === 'climate' ? ', Vorjahreswert' : '';
    return draft.stops
      .filter((stop) => isOutdoor(stop))
      .flatMap((stop) => {
        const mm = rain.get(dateOfDay(draft.startDate, stop.dayNumber));
        if (mm === undefined) return [];
        return [
          {
            ruleId: 'rain-outdoor',
            severity: 'error' as const,
            ...stopRef(stop),
            message: `${stop.title} liegt draußen, an Tag ${stop.dayNumber} regnet es (${formatMm(mm)} mm${note})`,
          },
        ];
      });
  },
};

function formatMm(mm: number): string {
  return mm.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}
