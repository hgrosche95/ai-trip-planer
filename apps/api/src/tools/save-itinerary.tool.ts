import type {
  CreateItineraryInput,
  ItinerariesService,
} from '../itineraries.service';
import { itineraryValidationErrors } from '../itinerary.dto';
import type { AgentTool } from './tool-registry';

// Als Factory, weil das Tool den ItinerariesService aus Nest braucht
export function createSaveItineraryTool(
  itinerariesService: ItinerariesService,
): AgentTool<CreateItineraryInput> {
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
              },
              required: ['dayNumber', 'order', 'title', 'category'],
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
  };
}
