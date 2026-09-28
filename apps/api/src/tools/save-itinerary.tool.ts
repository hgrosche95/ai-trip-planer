import type {
  CreateItineraryInput,
  ItinerariesService,
} from '../itineraries.service';
import { itineraryValidationErrors } from '../itinerary.dto';
import type { AgentTool, GlobeFocus } from './tool-registry';

type SaveItineraryOutput =
  { saved: true; itineraryId: string } | { error: string };

// Programmpunkte mit Koordinaten in Reiseablauf-Reihenfolge (Tag, dann
// Reihenfolge am Tag). Punkte ohne Ort fallen heraus. Liegen zwei aufeinander
// folgende Punkte am selben Ort (z.B. Hotel am Abend und am Morgen), bleibt
// nur einer übrig, sonst entstünde ein Bogen der Länge null.
export function routeFromStops(
  stops: CreateItineraryInput['stops'],
): GlobeFocus[] {
  const route: GlobeFocus[] = [];
  const ordered = [...stops].sort(
    (a, b) => a.dayNumber - b.dayNumber || a.order - b.order,
  );
  for (const stop of ordered) {
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) continue;
    const point = { name: stop.title, lat: stop.lat!, lng: stop.lng! };
    const previous = route.at(-1);
    if (previous?.lat === point.lat && previous.lng === point.lng) continue;
    route.push(point);
  }
  return route;
}

// Als Factory, weil das Tool den ItinerariesService aus Nest braucht
export function createSaveItineraryTool(
  itinerariesService: ItinerariesService,
): AgentTool<CreateItineraryInput, SaveItineraryOutput> {
  return {
    kind: 'tool',
    definition: {
      name: 'save_itinerary',
      description:
        'Speichert einen fertigen Reiseplan in der Datenbank. Nur aufrufen, wenn Ziel, Zeitraum, Budget und mindestens ein paar Programmpunkte feststehen.',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string' },
          startDate: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: { type: 'string', description: 'YYYY-MM-DD' },
          budgetCents: { type: 'integer' },
          currency: { type: 'string', description: 'z.B. EUR' },
          preferences: { type: 'array', items: { type: 'string' } },
          stops: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                dayNumber: { type: 'integer' },
                order: { type: 'integer' },
                title: { type: 'string' },
                description: { type: 'string' },
                category: {
                  type: 'string',
                  enum: [
                    'FOOD',
                    'CULTURE',
                    'SIGHTSEEING',
                    'ACCOMMODATION',
                    'TRANSPORT',
                    'OTHER',
                  ],
                },
                costCents: { type: 'integer' },
                lat: {
                  type: 'number',
                  description:
                    'Breitengrad des Orts, -90 bis 90. Hat der Punkt keinen festen Ort (z.B. Freizeit), die Koordinaten der Stadt, in der er stattfindet.',
                },
                lng: {
                  type: 'number',
                  description: 'Längengrad des Orts, -180 bis 180',
                },
              },
              // lat/lng Pflicht fürs Modell (in der REST-API optional): als
              // optionale Felder ließ das Modell sie meist weg, und der
              // Globus zeigte statt der Route nur das erste Ziel.
              required: [
                'dayNumber',
                'order',
                'title',
                'category',
                'lat',
                'lng',
              ],
            },
          },
        },
        required: [
          'destination',
          'startDate',
          'endDate',
          'budgetCents',
          'stops',
        ],
      },
    },
    async execute(input, { userId }) {
      // Der Plan kommt vom Modell, nicht durch die ValidationPipe. Ungültige
      // Angaben gehen als Tool-Fehler zurück, damit das Modell sie korrigieren
      // kann, statt dass der ganze Chat mit einer 500 abbricht.
      const errors = itineraryValidationErrors(input);
      if (errors.length > 0) {
        return { error: `Reiseplan ungültig: ${errors.join('; ')}` };
      }
      const itinerary = await itinerariesService.create(userId, input);
      return { saved: true, itineraryId: itinerary.id };
    },
    route(output, input) {
      if (!('saved' in output)) return undefined;
      const route = routeFromStops(input.stops);
      return route.length > 0 ? route : undefined;
    },
  };
}
