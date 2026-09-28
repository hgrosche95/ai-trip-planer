import type { ExternalCache } from './external-cache';
import { fetchJsonCached } from './http-client';
import type { ExternalResult } from './http-client';

// Overpass: Abfragen auf die OpenStreetMap-Daten, kostenlos und ohne Key.
// Die öffentliche Instanz ist gedrosselt und fällt gelegentlich aus, deshalb
// läuft jeder Aufruf über den Cache (7 Tage: Hotels ziehen selten um).

export type LodgingKind = 'hotel' | 'hostel' | 'guest_house' | 'apartment';

export interface Lodging {
  name: string;
  lat: number;
  lng: number;
  kind: LodgingKind;
  // OSM-Tag "stars", nur wenn als Zahl lesbar (z. B. "4" oder "3S")
  stars?: number;
  website?: string;
}

// Öffentliche Instanz; über OVERPASS_URL auf einen Spiegel (z. B.
// overpass.kumi.systems) umstellbar, wenn sie gedrosselt ist.
const OVERPASS_URL =
  process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const LODGING_KINDS: LodgingKind[] = [
  'hotel',
  'hostel',
  'guest_house',
  'apartment',
];
const DAY_MS = 24 * 60 * 60 * 1000;
const LODGING_TTL_MS = 7 * DAY_MS;
// Umkreis um das Ortszentrum: 2,5 km decken die Innenstadt der Städte in
// der Wissensbasis ab, ohne dass die Antwort groß wird.
export const LODGING_RADIUS_M = 2500;
// Höchstens so viele Unterkünfte kommen zurück, die nächsten zuerst
export const MAX_LODGINGS = 15;
// So viele Elemente liefert Overpass höchstens. Mehr als MAX_LODGINGS, weil
// Einträge ohne Namen oder doppelte Namen danach noch herausfallen.
const OVERPASS_LIMIT = 60;
// Overpass bricht serverseitig nach 10 s ab ([timeout:10]). Der HTTP-Timeout
// liegt knapp darüber, damit wir dessen Fehlermeldung nicht abschneiden.
const HTTP_TIMEOUT_MS = 12_000;

interface OverpassElement {
  type: string;
  lat?: number;
  lon?: number;
  // Bei Wegen und Relationen (Gebäudeumriss) liefert "out center" den Mittelpunkt
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

export class OverpassClient {
  constructor(private readonly cache: ExternalCache) {}

  // Unterkünfte mit Namen im Umkreis, sortiert nach Entfernung zum Mittelpunkt.
  async lodgings(
    lat: number,
    lng: number,
    radiusM = LODGING_RADIUS_M,
  ): Promise<ExternalResult<Lodging[]>> {
    // Auf ~1 km gerundet, wie beim Wetter: derselbe Stadtkern soll
    // denselben Cache-Eintrag treffen, auch wenn das Modell die Koordinaten
    // leicht anders angibt. Die Abfrage nutzt dieselben gerundeten Werte,
    // damit Schlüssel und Inhalt zusammenpassen.
    const latitude = lat.toFixed(2);
    const longitude = lng.toFixed(2);
    const query = lodgingQuery(latitude, longitude, radiusM);
    const result = await fetchJsonCached<OverpassResponse>(OVERPASS_URL, {
      cache: this.cache,
      cacheKey: `overpass:lodging:${latitude},${longitude}:${radiusM}`,
      provider: 'overpass',
      ttlMs: LODGING_TTL_MS,
      timeoutMs: HTTP_TIMEOUT_MS,
      isValid: isOverpassResponse,
      method: 'POST',
      body: new URLSearchParams({ data: query }).toString(),
      contentType: 'application/x-www-form-urlencoded',
    });
    if (!result.available) return result;

    const center = { lat: Number(latitude), lng: Number(longitude) };
    return {
      available: true,
      data: toLodgings(result.data.elements, center),
      cached: result.cached,
    };
  }
}

export function lodgingQuery(
  latitude: string,
  longitude: string,
  radiusM: number,
): string {
  const kinds = LODGING_KINDS.join('|');
  // nwr = Punkte, Wege und Relationen: Viele Hotels sind nur als
  // Gebäudeumriss eingetragen. Nur Einträge mit Namen, alles andere nützt
  // bei einer Empfehlung nichts.
  return [
    '[out:json][timeout:10];',
    `nwr["tourism"~"^(${kinds})$"]["name"](around:${radiusM},${latitude},${longitude});`,
    `out center ${OVERPASS_LIMIT};`,
  ].join('\n');
}

function toLodgings(
  elements: OverpassElement[],
  center: { lat: number; lng: number },
): Lodging[] {
  const seen = new Set<string>();
  const found: { lodging: Lodging; distance: number }[] = [];
  for (const element of elements) {
    const tags = element.tags ?? {};
    const name = tags.name?.trim();
    const kind = tags.tourism as LodgingKind;
    const lat = element.lat ?? element.center?.lat;
    const lng = element.lon ?? element.center?.lon;
    if (!name || !LODGING_KINDS.includes(kind)) continue;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    // Dasselbe Hotel steht manchmal als Punkt und als Gebäude drin
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const stars = parseStars(tags.stars);
    const website = tags.website ?? tags['contact:website'];
    found.push({
      lodging: {
        name: name.slice(0, 100),
        lat,
        lng,
        kind,
        ...(stars !== undefined && { stars }),
        ...(website?.startsWith('http') && { website }),
      },
      // Für die Reihenfolge genügt der Abstand in Grad, ohne Kugelformel
      distance: (lat - center.lat) ** 2 + (lng - center.lng) ** 2,
    });
  }
  return found
    .sort((a, b) => a.distance - b.distance)
    .slice(0, MAX_LODGINGS)
    .map(({ lodging }) => lodging);
}

// OSM erlaubt "4", "4.5" oder "3S" (Superior). Alles andere ignorieren.
function parseStars(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const stars = Number.parseFloat(value);
  return Number.isFinite(stars) && stars >= 1 && stars <= 7 ? stars : undefined;
}

function isOverpassResponse(data: unknown): data is OverpassResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as OverpassResponse).elements)
  );
}
