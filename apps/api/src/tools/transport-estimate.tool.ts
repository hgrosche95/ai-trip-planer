import type { OpenMeteoClient } from '../external/open-meteo.client';
import type { AgentTool, GlobeFocus } from './tool-registry';

interface TransportInput {
  origin: string;
  destination: string;
}

export type TransportMode = 'train' | 'flight';

export interface TransportOption {
  mode: TransportMode;
  // Strecke, auf die sich Preis und Dauer beziehen (Bahn: geschätzte
  // Streckenlänge, Flug: Luftlinie)
  distanceKm: number;
  priceMinEur: number;
  priceMaxEur: number;
  durationHours: number;
  co2Kg: number;
}

type TransportOutput =
  | {
      from: GlobeFocus;
      to: GlobeFocus;
      straightLineKm: number;
      recommended: TransportMode;
      options: TransportOption[];
      // Nichts davon ist ein echtes Angebot
      estimate: true;
      note: string;
      formula: string;
      cached: boolean;
    }
  | { error: string };

// Das Tarifmodell, alle Preise pro Person und einfache Fahrt. Es soll eine
// ehrliche Größenordnung liefern, keinen Preis: Echte Flug- und Bahnpreise
// hängen von Buchungszeitpunkt, Tag und Auslastung ab, und kostenlose
// Preis-APIs dafür gibt es nicht (Plan, Abschnitt 2.6).

// Schienen und Straßen verlaufen nicht auf der Luftlinie: grob 25 % Umweg.
export const DETOUR_FACTOR = 1.25;
// Bis zu dieser Luftlinie empfehlen wir die Bahn (Plan 2.6: "unter 800 km
// zuerst die Bahn vorschlagen").
export const TRAIN_RECOMMENDED_BELOW_KM = 800;
// Darüber bieten wir die Bahn gar nicht mehr an (Nachtzug-Grenze grob).
export const MAX_TRAIN_KM = 1500;
// Darunter gibt es kaum sinnvolle Flüge.
export const MIN_FLIGHT_KM = 300;
// Darunter ist es keine Anreise, sondern Nahverkehr.
export const MIN_DISTANCE_KM = 20;
// Bahn: Sparpreis bis Flexpreis pro Streckenkilometer, mindestens 20 €.
export const TRAIN_EUR_PER_KM: [min: number, max: number] = [0.06, 0.18];
export const TRAIN_MIN_EUR = 20;
// Mittlere Reisegeschwindigkeit mit Halten und Umstiegen.
export const TRAIN_SPEED_KMH = 100;
// Flug: Sockel (Steuern, Gebühren) plus Anteil pro Kilometer Luftlinie.
export const FLIGHT_BASE_EUR: [min: number, max: number] = [40, 120];
export const FLIGHT_EUR_PER_KM: [min: number, max: number] = [0.05, 0.14];
export const FLIGHT_SPEED_KMH = 750;
// Anfahrt zum Flughafen, Sicherheitskontrolle, Boarding, Gepäck.
export const FLIGHT_OVERHEAD_HOURS = 2.5;
// CO2-Äquivalente pro Personenkilometer, grobe Mittelwerte (Flug inkl.
// Nicht-CO2-Effekten, Bahn im europäischen Strommix).
export const CO2_KG_PER_KM: Record<TransportMode, number> = {
  train: 0.03,
  flight: 0.2,
};

export const TARIFF_FORMULA = `Bahn: Strecke = Luftlinie × ${DETOUR_FACTOR}, Preis = max(${TRAIN_MIN_EUR} €, ${TRAIN_EUR_PER_KM[0]}–${TRAIN_EUR_PER_KM[1]} € pro km), Dauer = Strecke / ${TRAIN_SPEED_KMH} km/h. Flug: Preis = ${FLIGHT_BASE_EUR[0]}–${FLIGHT_BASE_EUR[1]} € + ${FLIGHT_EUR_PER_KM[0]}–${FLIGHT_EUR_PER_KM[1]} € pro km Luftlinie, Dauer = Luftlinie / ${FLIGHT_SPEED_KMH} km/h + ${FLIGHT_OVERHEAD_HOURS} h. Pro Person, einfache Fahrt.`;
const ESTIMATE_NOTE =
  'Geschätzt aus der Entfernung, keine echten Verbindungen oder Angebote. Preise dem Nutzer als grobe Spanne nennen und auf die Buchungsseiten von Bahn bzw. Airlines verweisen.';

// Entfernung auf der Erdkugel (Haversine), in km.
export function haversineKm(
  a: Pick<GlobeFocus, 'lat' | 'lng'>,
  b: Pick<GlobeFocus, 'lat' | 'lng'>,
): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLng = (b.lng - a.lng) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function roundTo5(value: number): number {
  return Math.max(5, Math.round(value / 5) * 5);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// Das Tarifmodell als reine Funktion: Luftlinie rein, Optionen raus.
export function estimateTransport(straightLineKm: number): {
  recommended: TransportMode;
  options: TransportOption[];
} {
  const options: TransportOption[] = [];
  if (straightLineKm <= MAX_TRAIN_KM) {
    const railKm = straightLineKm * DETOUR_FACTOR;
    options.push({
      mode: 'train',
      distanceKm: Math.round(railKm),
      priceMinEur: roundTo5(
        Math.max(TRAIN_MIN_EUR, railKm * TRAIN_EUR_PER_KM[0]),
      ),
      priceMaxEur: roundTo5(
        Math.max(TRAIN_MIN_EUR, railKm * TRAIN_EUR_PER_KM[1]),
      ),
      durationHours: round1(railKm / TRAIN_SPEED_KMH),
      co2Kg: Math.round(railKm * CO2_KG_PER_KM.train),
    });
  }
  if (straightLineKm >= MIN_FLIGHT_KM) {
    options.push({
      mode: 'flight',
      distanceKm: Math.round(straightLineKm),
      priceMinEur: roundTo5(
        FLIGHT_BASE_EUR[0] + straightLineKm * FLIGHT_EUR_PER_KM[0],
      ),
      priceMaxEur: roundTo5(
        FLIGHT_BASE_EUR[1] + straightLineKm * FLIGHT_EUR_PER_KM[1],
      ),
      durationHours: round1(
        straightLineKm / FLIGHT_SPEED_KMH + FLIGHT_OVERHEAD_HOURS,
      ),
      co2Kg: Math.round(straightLineKm * CO2_KG_PER_KM.flight),
    });
  }
  return {
    recommended:
      straightLineKm < TRAIN_RECOMMENDED_BELOW_KM ? 'train' : 'flight',
    options,
  };
}

export function createTransportEstimateTool(
  geocoder: OpenMeteoClient,
): AgentTool<TransportInput, TransportOutput> {
  return {
    kind: 'tool',
    definition: {
      name: 'estimate_transport',
      description:
        'Schätzt die Anreise zwischen zwei Orten: Entfernung, Bahn und/oder Flug mit Preisspanne, Dauer und CO2 aus einem festen Tarifmodell. Das sind KEINE echten Verbindungen oder Preise.',
      parameters: {
        type: 'object',
        properties: {
          origin: {
            type: 'string',
            description: 'Abreiseort, z.B. "Berlin"',
          },
          destination: {
            type: 'string',
            description: 'Reiseziel, z.B. "Lissabon"',
          },
        },
        required: ['origin', 'destination'],
      },
    },
    execute: async ({ origin, destination }) => {
      for (const [field, value] of [
        ['origin', origin],
        ['destination', destination],
      ] as const) {
        if (typeof value !== 'string' || value.trim() === '') {
          return { error: `${field} darf nicht leer sein.` };
        }
      }

      const [fromGeo, toGeo] = await Promise.all([
        geocoder.geocode(origin),
        geocoder.geocode(destination),
      ]);
      if (!fromGeo.available) return { error: fromGeo.error };
      if (!toGeo.available) return { error: toGeo.error };
      if (!fromGeo.data) return notFound(origin);
      if (!toGeo.data) return notFound(destination);
      const from = toFocus(fromGeo.data);
      const to = toFocus(toGeo.data);

      const straightLineKm = haversineKm(from, to);
      if (straightLineKm < MIN_DISTANCE_KM) {
        return {
          error: `${from.name} und ${to.name} liegen weniger als ${MIN_DISTANCE_KM} km auseinander, das ist keine Anreise.`,
        };
      }

      return {
        from,
        to,
        straightLineKm: Math.round(straightLineKm),
        ...estimateTransport(straightLineKm),
        estimate: true,
        note: ESTIMATE_NOTE,
        formula: TARIFF_FORMULA,
        cached: fromGeo.cached && toGeo.cached,
      };
    },
    cached: (output) => ('options' in output ? output.cached : undefined),
    // Derselbe Bogen wie bei show_destination_on_globe mit origin
    flight: (output) =>
      'options' in output ? { from: output.from, to: output.to } : undefined,
    trace: (output) => ({
      metadata:
        'options' in output
          ? {
              hasError: false,
              recommended: output.recommended,
              cached: output.cached,
            }
          : { hasError: true },
    }),
  };
}

function notFound(place: string): { error: string } {
  return {
    error: `Ort "${place.trim().slice(0, 100)}" nicht gefunden. Versuche den Namen der nächsten größeren Stadt.`,
  };
}

function toFocus(place: GlobeFocus): GlobeFocus {
  return { name: place.name, lat: place.lat, lng: place.lng };
}
