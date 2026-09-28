import type { ExternalCache } from './external-cache';
import { fetchJsonCached } from './http-client';
import type { ExternalResult } from './http-client';

// Frankfurter: Referenzkurse der Europäischen Zentralbank, kostenlos und
// ohne Key. Die EZB veröffentlicht einmal pro Arbeitstag (gegen 16 Uhr MEZ),
// am Wochenende gilt der Kurs vom Freitag.

export interface ExchangeRate {
  from: string;
  to: string;
  // 1 Einheit von `from` = rate Einheiten von `to`
  rate: number;
  // Datum des EZB-Kurses (YYYY-MM-DD), nicht der Abfrage
  date: string;
}

// Über FRANKFURTER_URL austauschbar, falls der Dienst umzieht oder eine
// eigene Instanz genutzt wird (Frankfurter ist Open Source).
const FRANKFURTER_URL =
  process.env.FRANKFURTER_URL ?? 'https://api.frankfurter.app/latest';
// Die Kurse ändern sich höchstens einmal am Tag. 12 h halten die Zahl der
// Aufrufe klein und liefern trotzdem spätestens am Folgetag den neuen Kurs.
const RATE_TTL_MS = 12 * 60 * 60 * 1000;
const CURRENCY_CODE = /^[A-Z]{3}$/;

interface LatestResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_CODE.test(value);
}

export class FrankfurterClient {
  constructor(private readonly cache: ExternalCache) {}

  // Kurs von `from` nach `to`, beide als ISO-4217-Code in Großbuchstaben.
  async rate(from: string, to: string): Promise<ExternalResult<ExchangeRate>> {
    // Die Codes landen in URL und Cache-Schlüssel: nur drei Großbuchstaben
    if (!isCurrencyCode(from) || !isCurrencyCode(to)) {
      return {
        available: false,
        cached: false,
        error:
          'Währungscodes müssen aus drei Großbuchstaben bestehen (z. B. EUR).',
      };
    }
    // Frankfurter lehnt from = to ab, der Kurs ist ohnehin klar
    if (from === to) {
      return {
        available: true,
        data: { from, to, rate: 1, date: '' },
        cached: false,
      };
    }

    const params = new URLSearchParams({ from, to });
    const result = await fetchJsonCached<LatestResponse>(
      `${FRANKFURTER_URL}?${params}`,
      {
        cache: this.cache,
        cacheKey: `frankfurter:${from}:${to}`,
        provider: 'frankfurter',
        ttlMs: RATE_TTL_MS,
        isValid: (data): data is LatestResponse =>
          isLatestResponse(data) && typeof data.rates[to] === 'number',
      },
    );
    if (!result.available) return result;
    return {
      available: true,
      data: { from, to, rate: result.data.rates[to], date: result.data.date },
      cached: result.cached,
    };
  }
}

function isLatestResponse(data: unknown): data is LatestResponse {
  if (typeof data !== 'object' || data === null) return false;
  const { date, rates } = data as LatestResponse;
  return (
    typeof date === 'string' && typeof rates === 'object' && rates !== null
  );
}
