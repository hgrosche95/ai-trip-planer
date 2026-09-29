import type {
  OpenMeteoClient,
  WeatherDay,
  WeatherSource,
} from '../external/open-meteo.client';
import { addDays, daysBetween } from '../external/open-meteo.client';
import type { AgentTool, GlobeFocus, ToolWeather } from './tool-registry';

interface WeatherInput {
  place: string;
  startDate: string;
  endDate: string;
}

type WeatherOutput =
  | {
      place: GlobeFocus & { countryCode?: string };
      source: WeatherSource;
      // Nur bei climate: damit das Modell die Werte nicht als Vorhersage verkauft
      note?: string;
      days: WeatherDay[];
      // Für die Timeline ("Cache"); das Modell darf es ignorieren
      cached: boolean;
    }
  | { error: string };

// Mehr Tage machen das Tool-Ergebnis lang (Tokens!) und sind für die
// Planung einer Reise selten nötig. Längere Reisen fragt das Modell in
// Abschnitten ab.
export const MAX_WEATHER_DAYS = 14;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLIMATE_NOTE =
  'Keine Vorhersage: Werte desselben Zeitraums im Vorjahr als Anhaltspunkt. So auch dem Nutzer sagen.';

// Als Factory, weil das Tool den Open-Meteo-Client mit Cache braucht.
// `today` ist injizierbar, damit Tests die Prüfung "liegt in der
// Vergangenheit" mit festem Datum laufen lassen können.
export function createWeatherTool(
  client: OpenMeteoClient,
  today: () => string = () => new Date().toISOString().slice(0, 10),
): AgentTool<WeatherInput, WeatherOutput> {
  return {
    kind: 'tool',
    definition: {
      name: 'get_weather',
      description: `Liefert das Wetter pro Tag (Tiefst-/Höchsttemperatur, Niederschlag, Wetterlage) für einen Ort und Reisezeitraum. Bis 16 Tage im Voraus echte Vorhersage, danach Werte desselben Zeitraums im Vorjahr. Höchstens ${MAX_WEATHER_DAYS} Tage pro Aufruf.`,
      parameters: {
        type: 'object',
        properties: {
          place: {
            type: 'string',
            description: 'Ortsname, z.B. "Lissabon"',
          },
          startDate: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['place', 'startDate', 'endDate'],
      },
    },
    execute: async ({ place, startDate, endDate }) => {
      const invalid = validate(place, startDate, endDate, today());
      if (invalid) return { error: invalid };

      const geo = await client.geocode(place);
      if (!geo.available) return { error: geo.error };
      if (!geo.data) {
        return {
          error: `Ort "${place.trim().slice(0, 100)}" nicht gefunden. Versuche den Namen der nächsten größeren Stadt.`,
        };
      }
      const { name, lat, lng, countryCode } = geo.data;

      const weather = await client.dailyWeather(lat, lng, startDate, endDate);
      if (!weather.available) return { error: weather.error };

      return {
        place: { name, lat, lng, countryCode },
        source: weather.data.source,
        ...(weather.data.source === 'climate' && { note: CLIMATE_NOTE }),
        days: weather.data.days,
        // Nur ein Cache-Treffer, wenn nichts neu geholt werden musste
        cached: geo.cached && weather.cached,
      };
    },
    cached: (output) => ('days' in output ? output.cached : undefined),
    weather: (output): ToolWeather | undefined =>
      'days' in output
        ? {
            place: {
              name: output.place.name,
              lat: output.place.lat,
              lng: output.place.lng,
            },
            source: output.source,
            days: output.days,
          }
        : undefined,
    // Ortsname und Zeitraum sind keine persönlichen Angaben im Sinne des
    // Tracings, aber auch nicht nötig: Die Form reicht.
    trace: (output) => ({
      metadata:
        'days' in output
          ? {
              hasError: false,
              source: output.source,
              days: output.days.length,
              cached: output.cached,
            }
          : { hasError: true },
    }),
  };
}

function validate(
  place: unknown,
  startDate: unknown,
  endDate: unknown,
  today: string,
): string | undefined {
  if (typeof place !== 'string' || place.trim() === '') {
    return 'place darf nicht leer sein.';
  }
  if (!isIsoDate(startDate) || !isIsoDate(endDate)) {
    return 'startDate und endDate müssen gültige Daten im Format YYYY-MM-DD sein.';
  }
  if (endDate < startDate) {
    return 'endDate darf nicht vor startDate liegen.';
  }
  if (daysBetween(startDate, endDate) + 1 > MAX_WEATHER_DAYS) {
    return `Höchstens ${MAX_WEATHER_DAYS} Tage pro Aufruf. Teile längere Reisen in mehrere Aufrufe auf.`;
  }
  if (startDate < today) {
    // Häufigster Grund: Das Modell hat bei "10. Oktober" ein Jahr aus
    // seinem Training eingesetzt. Der Hinweis nennt das gemeinte Datum,
    // damit es den Aufruf korrigiert, statt den Nutzer zu fragen.
    return `startDate liegt in der Vergangenheit (heute ist ${today}). Nennt der Nutzer kein Jahr, ist das nächste zukünftige Datum gemeint, hier ${nextOccurrence(startDate, today)}. Rufe das Werkzeug damit erneut auf.`;
  }
  return undefined;
}

// Dasselbe Datum (Monat und Tag) im nächsten Jahr, in dem es nicht vor
// heute liegt: "2025-10-10" wird am 2026-09-29 zu "2026-10-10".
export function nextOccurrence(date: string, today: string): string {
  const monthDay = date.slice(5);
  const year = Number(today.slice(0, 4));
  const candidate = `${year}-${monthDay}`;
  return candidate >= today ? candidate : `${year + 1}-${monthDay}`;
}

// Prüft Format UND Kalender: "2026-02-30" hat das richtige Format, würde
// aber von Date.parse still auf den 2. März verschoben.
export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    addDays(value, 0) === value
  );
}
