import Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'search_flights',
    description:
      'Sucht Flüge zu einem Reiseziel für einen bestimmten Zeitraum und ein Budget. Gibt eine Liste von Flugoptionen mit Preis zurück.',
    input_schema: {
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
    input_schema: {
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
