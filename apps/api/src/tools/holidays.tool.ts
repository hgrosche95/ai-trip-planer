import type { NagerDateClient } from '../external/nager-date.client';
import type { OpenMeteoClient } from '../external/open-meteo.client';
import { daysBetween } from '../external/open-meteo.client';
import type { AgentTool, GlobeFocus } from './tool-registry';
import { isIsoDate } from './weather.tool';

interface HolidaysInput {
  place: string;
  startDate: string;
  endDate: string;
}

type HolidaysOutput =
  | {
      place: GlobeFocus;
      countryCode: string;
      // Nur die Feiertage im Reisezeitraum
      holidays: { date: string; name: string }[];
      cached: boolean;
    }
  | { error: string };

// Wie beim Wetter: längere Zeiträume braucht die Planung nicht
const MAX_DAYS = 31;

// Gesetzliche Feiertage am Reiseziel im Reisezeitraum. Nur für den
// Recherche-Agenten des Orchestrators; der Classic-Agent bekommt das Tool
// nicht (weniger Tool-Definitionen im Prompt).
export function createHolidaysTool(
  geocoder: OpenMeteoClient,
  client: NagerDateClient,
): AgentTool<HolidaysInput, HolidaysOutput> {
  return {
    kind: 'tool',
    definition: {
      name: 'get_public_holidays',
      description:
        'Liefert die landesweiten gesetzlichen Feiertage am Reiseziel im Reisezeitraum (Museen und Geschäfte haben dann oft geschlossen).',
      parameters: {
        type: 'object',
        properties: {
          place: { type: 'string', description: 'Ortsname, z.B. "Lissabon"' },
          startDate: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['place', 'startDate', 'endDate'],
      },
    },
    execute: async ({ place, startDate, endDate }) => {
      if (typeof place !== 'string' || place.trim() === '') {
        return { error: 'place darf nicht leer sein.' };
      }
      if (
        !isIsoDate(startDate) ||
        !isIsoDate(endDate) ||
        endDate < startDate ||
        daysBetween(startDate, endDate) + 1 > MAX_DAYS
      ) {
        return {
          error: `startDate und endDate im Format YYYY-MM-DD, höchstens ${MAX_DAYS} Tage.`,
        };
      }
      const geo = await geocoder.geocode(place);
      if (!geo.available) return { error: geo.error };
      if (!geo.data?.countryCode) {
        return { error: `Land von "${place.trim().slice(0, 100)}" unbekannt.` };
      }
      const { name, lat, lng } = geo.data;
      const countryCode = geo.data.countryCode.toUpperCase();

      // Eine Reise über Silvester braucht zwei Jahre
      const years = [
        ...new Set([
          Number(startDate.slice(0, 4)),
          Number(endDate.slice(0, 4)),
        ]),
      ];
      const results = await Promise.all(
        years.map((year) => client.holidays(year, countryCode)),
      );
      const failed = results.find((result) => !result.available);
      if (failed && !failed.available) return { error: failed.error };
      const holidays = results
        .flatMap((result) => result.data ?? [])
        .filter(({ date }) => date >= startDate && date <= endDate)
        .map(({ date, localName }) => ({ date, name: localName }));
      return {
        place: { name, lat, lng },
        countryCode,
        holidays,
        cached: geo.cached && results.every((result) => result.cached),
      };
    },
    cached: (output) => ('holidays' in output ? output.cached : undefined),
    trace: (output) => ({
      metadata:
        'holidays' in output
          ? { hasError: false, holidays: output.holidays.length }
          : { hasError: true },
    }),
  };
}
