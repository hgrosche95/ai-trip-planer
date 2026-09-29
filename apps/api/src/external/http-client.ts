import type { ExternalCache } from './external-cache';

// Ergebnis eines externen Aufrufs. Wie searchKnowledge() in rag-client.ts
// wirft fetchJsonCached nie: Ein langsamer oder ausgefallener Dienst soll
// nicht den ganzen Chat abbrechen, sondern als Tool-Ergebnis beim Modell
// ankommen, das dem Nutzer dann ehrlich sagt, was fehlt.
export type ExternalResult<T> =
  | { available: true; data: T; cached: boolean }
  | { available: false; data?: undefined; cached: false; error: string };

export interface FetchJsonOptions<T> {
  cache: ExternalCache;
  // Eindeutiger Schlüssel inkl. Anbieter, z. B. "open-meteo:geocode:lissabon"
  cacheKey: string;
  // Anbietername, landet in ExternalApiCache.provider (für Statistik/Aufräumen)
  provider: string;
  ttlMs: number;
  timeoutMs?: number;
  // Prüft die Antwort, bevor sie zurückkommt und im Cache landet. Ohne diese
  // Prüfung würde eine unerwartete Antwort (z. B. Fehlerseite mit Status 200)
  // für Stunden oder Tage im Cache festsitzen.
  isValid?: (data: unknown) => data is T;
  // Ohne Angabe ein GET. Overpass erwartet die Abfrage als POST-Formular,
  // weil sie für eine URL schnell zu lang wird.
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.EXTERNAL_API_TIMEOUT_MS ?? 5000);
// Öffentliche Gratis-APIs (Open-Meteo, Overpass) bitten darum, dass sich
// Clients mit einem erkennbaren User-Agent melden, damit sie bei Problemen
// jemanden erreichen können, statt die IP zu sperren.
export const USER_AGENT =
  process.env.EXTERNAL_API_USER_AGENT ??
  'ai-trip-planner (github.com/hgrosche95/ai-trip-planer)';

/**
 * Holt JSON von einer externen API, mit Cache davor. Reihenfolge: Cache
 * fragen, bei Treffer sofort zurück (cached: true); sonst mit Timeout
 * abrufen, prüfen und für ttlMs speichern. Fehler, Timeouts und Status
 * außerhalb 2xx werden nicht gecacht: Der nächste Aufruf soll es erneut
 * versuchen dürfen.
 */
export async function fetchJsonCached<T>(
  url: string,
  options: FetchJsonOptions<T>,
): Promise<ExternalResult<T>> {
  const { cache, cacheKey, provider, ttlMs, isValid } = options;

  const hit = await cache.get(cacheKey);
  if (hit !== undefined && (!isValid || isValid(hit))) {
    return { available: true, data: hit as T, cached: true };
  }

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        ...(options.contentType && { 'Content-Type': options.contentType }),
      },
      ...(options.body !== undefined && { body: options.body }),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) {
      return unavailable(
        `${provider} antwortete mit Status ${response.status}`,
      );
    }
    const data: unknown = await response.json();
    if (isValid && !isValid(data)) {
      return unavailable(`${provider} lieferte eine unerwartete Antwort`);
    }
    await cache.set(cacheKey, provider, data, ttlMs);
    return { available: true, data: data as T, cached: false };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'TimeoutError'
        ? 'Zeitüberschreitung'
        : error instanceof Error
          ? error.message
          : String(error);
    return unavailable(`${provider} nicht erreichbar: ${reason}`);
  }
}

function unavailable(error: string): ExternalResult<never> {
  return { available: false, cached: false, error };
}
