import type { OpenMeteoClient } from '../external/open-meteo.client';
import { daysBetween } from '../external/open-meteo.client';
import type { LodgingKind, OverpassClient } from '../external/overpass.client';
import { LODGING_RADIUS_M } from '../external/overpass.client';
import type { AgentTool, GlobeFocus, ToolLodging } from './tool-registry';
import { isIsoDate } from './weather.tool';

interface LodgingInput {
  place: string;
  checkIn?: string;
  checkOut?: string;
  budgetPerNightEur?: number;
}

export interface LodgingItem {
  name: string;
  kind: LodgingKind;
  stars?: number;
  lat: number;
  lng: number;
  // Geschätzte Spanne pro Nacht, siehe estimateNightlyPrice()
  priceMinEur: number;
  priceMaxEur: number;
  // Nur mit Budget: passt zumindest das untere Ende der Spanne?
  withinBudget?: boolean;
}

type LodgingOutput =
  | {
      place: GlobeFocus;
      // Namen und Orte sind echt (OpenStreetMap), die Preise nicht
      estimate: true;
      note: string;
      // Woraus die Preise geschätzt sind, damit das Modell es erklären kann
      priceBasis: string;
      nights?: number;
      items: LodgingItem[];
      cached: boolean;
    }
  | { error: string };

// Preisniveau einer Stadt: Spanne für ein Doppelzimmer in einem
// Mittelklasse-Hotel (3 Sterne) pro Nacht, außerhalb von Messen und
// Großereignissen. Grobe Werte aus öffentlichen Preisübersichten, gerundet.
// Vereinfachung: Laut Plan gehören die Werte ins Frontmatter von
// data/knowledge/*.md; solange es nur vier Städte sind, stehen sie hier.
export interface CityPriceLevel {
  // 1 = günstig ... 4 = sehr teuer
  level: 1 | 2 | 3 | 4;
  hotelNightEur: [min: number, max: number];
}

export const CITY_PRICE_LEVELS: Record<string, CityPriceLevel> = {
  wien: { level: 3, hotelNightEur: [90, 170] },
  berlin: { level: 3, hotelNightEur: [85, 160] },
  rom: { level: 3, hotelNightEur: [95, 180] },
  lissabon: { level: 2, hotelNightEur: [75, 140] },
};
// Andere Schreibweisen, wie sie Nutzer oder das Geocoding liefern
const CITY_ALIASES: Record<string, string> = {
  vienna: 'wien',
  lisbon: 'lissabon',
  lisboa: 'lissabon',
  rome: 'rom',
  roma: 'rom',
};
// Für alle anderen Orte: europäischer Durchschnitt
export const DEFAULT_PRICE_LEVEL: CityPriceLevel = {
  level: 2,
  hotelNightEur: [70, 140],
};

// Faktor auf die Hotel-Spanne je Unterkunftsart. Hostel = ein Bett im
// Mehrbettzimmer, deshalb deutlich darunter.
export const KIND_PRICE_FACTORS: Record<LodgingKind, number> = {
  hotel: 1,
  apartment: 0.9,
  guest_house: 0.7,
  hostel: 0.3,
};

// Faktor je Sterne (OSM-Tag), ohne Angabe wie 3 Sterne
export function starFactor(stars: number | undefined): number {
  if (stars === undefined) return 1;
  if (stars >= 5) return 2;
  if (stars >= 4) return 1.35;
  if (stars >= 3) return 1;
  return 0.75;
}

// Auf 5 € gerundet: Genauer ist die Schätzung nicht, und glatte Zahlen
// sehen auch nicht nach einem echten Angebot aus.
function roundTo5(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5);
}

// Preis pro Nacht = Hotel-Spanne der Stadt × Faktor Art × Faktor Sterne
export function estimateNightlyPrice(
  city: CityPriceLevel,
  kind: LodgingKind,
  stars?: number,
): { priceMinEur: number; priceMaxEur: number } {
  const factor = KIND_PRICE_FACTORS[kind] * starFactor(stars);
  return {
    priceMinEur: roundTo5(city.hotelNightEur[0] * factor),
    priceMaxEur: roundTo5(city.hotelNightEur[1] * factor),
  };
}

export function priceLevelFor(...names: string[]): {
  city?: string;
  level: CityPriceLevel;
} {
  for (const name of names) {
    const key = normalize(name);
    const city = CITY_ALIASES[key] ?? key;
    if (CITY_PRICE_LEVELS[city]) {
      return { city, level: CITY_PRICE_LEVELS[city] };
    }
  }
  return { level: DEFAULT_PRICE_LEVEL };
}

function normalize(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Das Tool-Ergebnis geht gekürzt ans Modell (LLM_MAX_TOOL_RESULT_CHARS,
// Standard 2000 Zeichen). 10 Einträge mit gerundeten Koordinaten passen
// sicher hinein.
export const MAX_LODGING_ITEMS = 10;
const MAX_NIGHTS = 30;
const ESTIMATE_NOTE =
  'Namen und Lage stammen aus OpenStreetMap. Preise geschätzt aus dem Preisniveau der Stadt und der Art der Unterkunft, keine echten Angebote und keine Verfügbarkeit. So auch dem Nutzer sagen.';

export function createLodgingTool(
  geocoder: OpenMeteoClient,
  overpass: OverpassClient,
): AgentTool<LodgingInput, LodgingOutput> {
  return {
    kind: 'tool',
    definition: {
      name: 'search_lodging',
      description:
        'Sucht echte Unterkünfte (Hotels, Hostels, Pensionen, Apartments) aus OpenStreetMap im Zentrum eines Ortes. Liefert Name, Art, Sterne, Koordinaten und eine GESCHÄTZTE Preisspanne pro Nacht (keine echten Angebote, keine Verfügbarkeit).',
      parameters: {
        type: 'object',
        properties: {
          place: {
            type: 'string',
            description: 'Ortsname, z.B. "Lissabon"',
          },
          checkIn: {
            type: 'string',
            description: 'Optional: Anreisedatum, YYYY-MM-DD',
          },
          checkOut: {
            type: 'string',
            description: 'Optional: Abreisedatum, YYYY-MM-DD',
          },
          budgetPerNightEur: {
            type: 'number',
            description:
              'Optional: Budget pro Nacht in Euro; passende Unterkünfte kommen zuerst',
          },
        },
        required: ['place'],
      },
    },
    execute: async ({ place, checkIn, checkOut, budgetPerNightEur }) => {
      const invalid = validate(place, checkIn, checkOut, budgetPerNightEur);
      if (invalid) return { error: invalid };

      const geo = await geocoder.geocode(place);
      if (!geo.available) return { error: geo.error };
      if (!geo.data) {
        return {
          error: `Ort "${place.trim().slice(0, 100)}" nicht gefunden. Versuche den Namen der nächsten größeren Stadt.`,
        };
      }
      const { name, lat, lng } = geo.data;

      const lodgings = await overpass.lodgings(lat, lng);
      if (!lodgings.available) {
        return {
          error: `${lodgings.error}. Plane ohne konkrete Unterkunft und sag dem Nutzer, dass die Unterkunftssuche gerade nicht verfügbar ist.`,
        };
      }

      const { city, level } = priceLevelFor(name, place);
      let items: LodgingItem[] = lodgings.data.map((lodging) => ({
        name: lodging.name,
        kind: lodging.kind,
        ...(lodging.stars !== undefined && { stars: lodging.stars }),
        lat: round4(lodging.lat),
        lng: round4(lodging.lng),
        ...estimateNightlyPrice(level, lodging.kind, lodging.stars),
      }));
      if (budgetPerNightEur !== undefined) {
        // Stabil sortiert: Innerhalb der Gruppen bleibt die Nähe zum Zentrum
        items = items
          .map((item) => ({
            ...item,
            withinBudget: item.priceMinEur <= budgetPerNightEur,
          }))
          .sort((a, b) => Number(b.withinBudget) - Number(a.withinBudget));
      }

      return {
        place: { name, lat, lng },
        estimate: true,
        note:
          items.length > 0
            ? ESTIMATE_NOTE
            : `In OpenStreetMap keine Unterkünfte mit Namen im Umkreis von ${LODGING_RADIUS_M / 1000} km gefunden. Plane ohne konkrete Unterkunft und sag das dem Nutzer.`,
        priceBasis: `${city ? `Preisniveau ${name}` : 'Europäischer Durchschnitt'} (${level.level} von 4): Mittelklasse-Hotel ca. ${level.hotelNightEur[0]}–${level.hotelNightEur[1]} € pro Nacht und Doppelzimmer, Hostel pro Bett`,
        ...(checkIn && checkOut && { nights: daysBetween(checkIn, checkOut) }),
        items: items.slice(0, MAX_LODGING_ITEMS),
        cached: geo.cached && lodgings.cached,
      };
    },
    cached: (output) => ('items' in output ? output.cached : undefined),
    lodging: (output): ToolLodging | undefined =>
      'items' in output && output.items.length > 0
        ? {
            place: output.place,
            items: output.items.map(
              ({ name, lat, lng, kind, priceMinEur, priceMaxEur }) => ({
                name,
                lat,
                lng,
                kind,
                priceMinEur,
                priceMaxEur,
              }),
            ),
          }
        : undefined,
    trace: (output) => ({
      metadata:
        'items' in output
          ? {
              hasError: false,
              items: output.items.length,
              cached: output.cached,
            }
          : { hasError: true },
    }),
  };
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function validate(
  place: unknown,
  checkIn: unknown,
  checkOut: unknown,
  budget: unknown,
): string | undefined {
  if (typeof place !== 'string' || place.trim() === '') {
    return 'place darf nicht leer sein.';
  }
  if ((checkIn === undefined) !== (checkOut === undefined)) {
    return 'checkIn und checkOut nur gemeinsam angeben.';
  }
  if (checkIn !== undefined) {
    if (!isIsoDate(checkIn) || !isIsoDate(checkOut)) {
      return 'checkIn und checkOut müssen gültige Daten im Format YYYY-MM-DD sein.';
    }
    const nights = daysBetween(checkIn, checkOut);
    if (nights < 1) return 'checkOut muss nach checkIn liegen.';
    if (nights > MAX_NIGHTS) return `Höchstens ${MAX_NIGHTS} Nächte.`;
  }
  if (
    budget !== undefined &&
    (typeof budget !== 'number' || !Number.isFinite(budget) || budget <= 0)
  ) {
    return 'budgetPerNightEur muss eine positive Zahl sein.';
  }
  return undefined;
}
