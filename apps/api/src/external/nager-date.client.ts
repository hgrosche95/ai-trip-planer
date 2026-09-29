import type { ExternalCache } from './external-cache';
import { fetchJsonCached } from './http-client';
import type { ExternalResult } from './http-client';

// Nager.Date: gesetzliche Feiertage pro Land und Jahr, kostenlos und ohne
// Key. Für den Kritiker: Museen haben an Feiertagen oft zu oder geänderte
// Öffnungszeiten.

export interface PublicHoliday {
  date: string;
  // Name in der Landessprache ("Implantação da República")
  localName: string;
  // Englischer Name ("Republic Day")
  name: string;
}

// Über NAGER_DATE_URL austauschbar (Nager.Date ist Open Source und lässt
// sich selbst betreiben)
const NAGER_DATE_URL =
  process.env.NAGER_DATE_URL ?? 'https://date.nager.at/api/v3/PublicHolidays';
// Feiertage eines Jahres stehen lange fest
const HOLIDAYS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COUNTRY_CODE = /^[A-Z]{2}$/;

interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  // false: gilt nur in einzelnen Regionen (counties)
  global: boolean;
}

export class NagerDateClient {
  constructor(private readonly cache: ExternalCache) {}

  // Landesweite Feiertage eines Jahres. Regionale (nur in einzelnen
  // Bundesländern oder Provinzen) fehlen bewusst: Ob das Reiseziel dazu
  // gehört, wissen wir nicht sicher.
  async holidays(
    year: number,
    countryCode: string,
  ): Promise<ExternalResult<PublicHoliday[]>> {
    // Jahr und Code landen in URL und Cache-Schlüssel
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return { available: false, cached: false, error: 'Ungültiges Jahr.' };
    }
    if (!COUNTRY_CODE.test(countryCode)) {
      return {
        available: false,
        cached: false,
        error: 'Ländercode muss aus zwei Großbuchstaben bestehen (z. B. PT).',
      };
    }
    const result = await fetchJsonCached<NagerHoliday[]>(
      `${NAGER_DATE_URL}/${year}/${countryCode}`,
      {
        cache: this.cache,
        cacheKey: `nager-date:${year}:${countryCode}`,
        provider: 'nager-date',
        ttlMs: HOLIDAYS_TTL_MS,
        isValid: (data): data is NagerHoliday[] =>
          Array.isArray(data) && data.every(isNagerHoliday),
      },
    );
    if (!result.available) return result;
    return {
      available: true,
      data: result.data
        .filter((holiday) => holiday.global)
        .map(({ date, localName, name }) => ({ date, localName, name })),
      cached: result.cached,
    };
  }
}

function isNagerHoliday(data: unknown): data is NagerHoliday {
  if (typeof data !== 'object' || data === null) return false;
  const { date, localName, name, global } = data as NagerHoliday;
  return (
    typeof date === 'string' &&
    typeof localName === 'string' &&
    typeof name === 'string' &&
    typeof global === 'boolean'
  );
}
