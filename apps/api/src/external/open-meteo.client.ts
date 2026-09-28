import type { ExternalCache } from './external-cache';
import { fetchJsonCached } from './http-client';
import type { ExternalResult } from './http-client';

// Open-Meteo: Geokodierung und Wetter, kostenlos und ohne API-Key
// (nicht-kommerzielle Nutzung, fair use). Alle Aufrufe laufen über den
// Cache, weil sich Reiseziele und -daten in einer Unterhaltung oft
// wiederholen und die öffentliche Instanz gedrosselt wird.

export interface GeocodedPlace {
  name: string;
  lat: number;
  lng: number;
  // ISO-3166-Ländercode, z. B. "PT" (später für Feiertage über Nager.Date)
  countryCode?: string;
  timezone?: string;
}

export interface WeatherDay {
  date: string;
  tMin: number;
  tMax: number;
  precipMm: number;
  // WMO-Wettercode, siehe weatherLabel()
  code: number;
  label: string;
}

// forecast: echte Vorhersage (bis 16 Tage im Voraus). climate: derselbe
// Zeitraum im Vorjahr als Anhaltspunkt - keine Vorhersage, und das muss
// auch so beim Nutzer ankommen.
export type WeatherSource = 'forecast' | 'climate';

export interface DailyWeather {
  source: WeatherSource;
  days: WeatherDay[];
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Orte wandern nicht: Koordinaten dürfen lange im Cache bleiben.
const GEOCODE_TTL_MS = 30 * DAY_MS;
// Vorhersagen werden mehrmals täglich neu gerechnet, 3 h sind ein
// Kompromiss zwischen Aktualität und Schonung der API.
const FORECAST_TTL_MS = 3 * HOUR_MS;
// Vergangene Messwerte ändern sich nicht mehr.
const CLIMATE_TTL_MS = 30 * DAY_MS;
// Open-Meteo rechnet 16 Tage voraus: heute plus 15 weitere Tage.
export const FORECAST_HORIZON_DAYS = 16;

const DAILY_FIELDS =
  'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum';

interface GeocodingResponse {
  results?: {
    name: string;
    latitude: number;
    longitude: number;
    country_code?: string;
    timezone?: string;
  }[];
}

interface DailyResponse {
  daily: {
    time: string[];
    weather_code: (number | null)[];
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    precipitation_sum: (number | null)[];
  };
}

export class OpenMeteoClient {
  // `now` ist injizierbar, damit Tests festlegen können, ob ein Zeitraum
  // noch in der Vorhersage liegt oder schon Vorjahreswerte braucht.
  constructor(
    private readonly cache: ExternalCache,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // data ist null, wenn Open-Meteo den Ort nicht kennt: Das ist kein
  // Ausfall, das Modell soll den Namen dann anders schreiben können.
  async geocode(name: string): Promise<ExternalResult<GeocodedPlace | null>> {
    const query = name.trim();
    const params = new URLSearchParams({
      name: query,
      count: '1',
      language: 'de',
      format: 'json',
    });
    const result = await fetchJsonCached<GeocodingResponse>(
      `${GEOCODING_URL}?${params}`,
      {
        cache: this.cache,
        cacheKey: `open-meteo:geocode:${query.toLowerCase()}`,
        provider: 'open-meteo',
        ttlMs: GEOCODE_TTL_MS,
        isValid: isGeocodingResponse,
      },
    );
    if (!result.available) return result;
    const first = result.data.results?.[0];
    const place: GeocodedPlace | null = first
      ? {
          name: first.name,
          lat: first.latitude,
          lng: first.longitude,
          countryCode: first.country_code,
          timezone: first.timezone,
        }
      : null;
    return { available: true, data: place, cached: result.cached };
  }

  // Tageswerte für startDate..endDate (YYYY-MM-DD, beide inklusive). Liegt
  // der ganze Zeitraum im Vorhersagefenster, kommt die Vorhersage; sonst
  // derselbe Zeitraum im Vorjahr aus dem Archiv, zurückgerechnet auf die
  // angefragten Daten.
  async dailyWeather(
    lat: number,
    lng: number,
    startDate: string,
    endDate: string,
  ): Promise<ExternalResult<DailyWeather>> {
    // Auf ~1 km runden: "38.7223" und "38.72" sind für das Wetter derselbe
    // Ort, und so trifft der Cache auch bei leicht anderen Koordinaten.
    const latitude = lat.toFixed(2);
    const longitude = lng.toFixed(2);
    const source = this.sourceFor(startDate, endDate);
    const dayCount = daysBetween(startDate, endDate) + 1;
    const queryStart =
      source === 'forecast' ? startDate : minusOneYear(startDate);
    const queryEnd = addDays(queryStart, dayCount - 1);

    const params = new URLSearchParams({
      latitude,
      longitude,
      daily: DAILY_FIELDS,
      timezone: 'auto',
      start_date: queryStart,
      end_date: queryEnd,
    });
    const result = await fetchJsonCached<DailyResponse>(
      `${source === 'forecast' ? FORECAST_URL : ARCHIVE_URL}?${params}`,
      {
        cache: this.cache,
        cacheKey: `open-meteo:${source}:${latitude},${longitude}:${queryStart}:${queryEnd}`,
        provider: 'open-meteo',
        ttlMs: source === 'forecast' ? FORECAST_TTL_MS : CLIMATE_TTL_MS,
        isValid: isDailyResponse,
      },
    );
    if (!result.available) return result;

    const { daily } = result.data;
    const days: WeatherDay[] = [];
    for (let index = 0; index < dayCount; index++) {
      const tMax = daily.temperature_2m_max[index];
      const tMin = daily.temperature_2m_min[index];
      // Fehlende Messwerte (null) lieber weglassen als 0 °C erfinden
      if (tMax == null || tMin == null) continue;
      const code = daily.weather_code[index] ?? 0;
      days.push({
        // Bei climate die angefragten Daten, nicht die des Vorjahrs:
        // Die Anzeige soll zu den Reisetagen passen.
        date: addDays(startDate, index),
        tMin: Math.round(tMin),
        tMax: Math.round(tMax),
        precipMm: Math.round((daily.precipitation_sum[index] ?? 0) * 10) / 10,
        code,
        label: weatherLabel(code),
      });
    }
    return { available: true, data: { source, days }, cached: result.cached };
  }

  private sourceFor(startDate: string, endDate: string): WeatherSource {
    const today = this.now().toISOString().slice(0, 10);
    const lastForecastDay = addDays(today, FORECAST_HORIZON_DAYS - 1);
    return startDate >= today && endDate <= lastForecastDay
      ? 'forecast'
      : 'climate';
  }
}

// Kurzer deutscher Text zum WMO-Wettercode, wie Open-Meteo ihn liefert
// (https://open-meteo.com/en/docs, Abschnitt "WMO Weather interpretation codes").
export function weatherLabel(code: number): string {
  if (code === 0) return 'Klar';
  if (code === 1) return 'Überwiegend klar';
  if (code === 2) return 'Teils bewölkt';
  if (code === 3) return 'Bedeckt';
  if (code === 45 || code === 48) return 'Nebel';
  if (code >= 51 && code <= 57) return 'Nieselregen';
  if (code === 61) return 'Leichter Regen';
  if (code === 63) return 'Regen';
  if (code === 65) return 'Starker Regen';
  if (code === 66 || code === 67) return 'Gefrierender Regen';
  if (code >= 71 && code <= 77) return 'Schnee';
  if (code >= 80 && code <= 82) return 'Regenschauer';
  if (code === 85 || code === 86) return 'Schneeschauer';
  if (code === 95) return 'Gewitter';
  if (code === 96 || code === 99) return 'Gewitter mit Hagel';
  return 'Unbekannt';
}

// Datumsrechnung auf "YYYY-MM-DD"-Strings in UTC: Reisetage sind
// Kalendertage, Zeitzonen und Sommerzeit dürfen hier nichts verschieben.
export function addDays(date: string, days: number): string {
  const time = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(time).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

// Der 29. Februar wird im Vorjahr zum 28., damit es das Datum gibt.
function minusOneYear(date: string): string {
  const [year, month, day] = date.split('-');
  const shiftedDay = month === '02' && day === '29' ? '28' : day;
  return `${Number(year) - 1}-${month}-${shiftedDay}`;
}

function isGeocodingResponse(data: unknown): data is GeocodingResponse {
  if (typeof data !== 'object' || data === null) return false;
  const results = (data as GeocodingResponse).results;
  // Ohne Treffer lässt Open-Meteo das Feld results ganz weg
  return (
    results === undefined ||
    (Array.isArray(results) &&
      results.every(
        (r) =>
          typeof r.name === 'string' &&
          typeof r.latitude === 'number' &&
          typeof r.longitude === 'number',
      ))
  );
}

function isDailyResponse(data: unknown): data is DailyResponse {
  const daily = (data as DailyResponse | null)?.daily;
  return (
    typeof daily === 'object' &&
    daily !== null &&
    Array.isArray(daily.time) &&
    Array.isArray(daily.weather_code) &&
    Array.isArray(daily.temperature_2m_max) &&
    Array.isArray(daily.temperature_2m_min) &&
    Array.isArray(daily.precipitation_sum)
  );
}
