import { LlmToolDefinition } from './llm/llm-provider.interface';
import { searchTravelKnowledge } from './rag-client';

export { searchTravelKnowledge };

export const tools: LlmToolDefinition[] = [
  {
    name: 'search_travel_knowledge',
    description:
      'Durchsucht eine kuratierte Wissensbasis zu Reisezielen (Sehenswürdigkeiten, Essen & Trinken, Transport) nach Fakten. Bei Faktenfragen zu einem konkreten Reiseziel immer zuerst dieses Tool nutzen, statt aus dem Gedächtnis zu antworten - die Treffer enthalten Quellenangaben, mit denen du deine Aussage belegen kannst. Liefert das Tool keine passenden Treffer, sag das dem Nutzer ehrlich, statt zu raten.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Die Suchanfrage, z.B. "Was kann man in Lissabon essen?"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_flights',
    description:
      'Sucht Flüge zu einem Reiseziel für einen bestimmten Zeitraum und ein Budget. Gibt eine Liste von Flugoptionen mit Preis zurück.',
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'Zielort, z.B. "Lissabon"',
        },
        startDate: {
          type: 'string',
          description: 'Anreisedatum, Format YYYY-MM-DD',
        },
        endDate: {
          type: 'string',
          description: 'Abreisedatum, Format YYYY-MM-DD',
        },
        budgetCents: {
          type: 'integer',
          description: 'Verfügbares Budget in Cent',
        },
      },
      required: ['destination', 'startDate', 'endDate', 'budgetCents'],
    },
  },
  {
    name: 'search_hotels',
    description:
      'Sucht Hotels an einem Reiseziel für einen bestimmten Zeitraum und ein Budget. Gibt eine Liste von Hotel-Optionen mit Preis zurück.',
    parameters: {
      type: 'object',
      properties: {
        destination: {
          type: 'string',
          description: 'Zielort, z.B. "Lissabon"',
        },
        startDate: {
          type: 'string',
          description: 'Anreisedatum, Format YYYY-MM-DD',
        },
        endDate: {
          type: 'string',
          description: 'Abreisedatum, Format YYYY-MM-DD',
        },
        budgetCents: {
          type: 'integer',
          description: 'Verfügbares Budget in Cent',
        },
      },
      required: ['destination', 'startDate', 'endDate', 'budgetCents'],
    },
  },
];

export function searchFlights(input: {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
}) {
  return {
    options: [
      {
        airline: 'AirEurope',
        priceCents: 12000,
        departure: input.startDate,
        return: input.endDate,
      },
      {
        airline: 'BudgetWings',
        priceCents: 8500,
        departure: input.startDate,
        return: input.endDate,
      },
    ],
  };
}

export function searchHotels(input: {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
}) {
  return {
    options: [
      {
        name: `Hotel Central ${input.destination}`,
        pricePerNightCents: 9000,
        rating: 4.2,
      },
      {
        name: `Cozy Stay ${input.destination}`,
        pricePerNightCents: 5500,
        rating: 3.8,
      },
    ],
  };
}
