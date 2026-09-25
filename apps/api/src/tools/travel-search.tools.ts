import type { LlmToolDefinition } from '../llm/llm-provider.interface';
import type { AgentTool } from './tool-registry';

// Flug- und Hotelsuche liefern simulierte Daten (siehe README), es gibt keine
// Anbindung an echte Buchungs-APIs.
interface TravelSearchInput {
  destination: string;
  startDate: string;
  endDate: string;
  budgetCents: number;
}

const travelSearchParameters: LlmToolDefinition['parameters'] = {
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
};

export const searchFlightsTool: AgentTool<TravelSearchInput> = {
  kind: 'tool',
  definition: {
    name: 'search_flights',
    description:
      'Sucht Flüge zu einem Reiseziel für einen bestimmten Zeitraum und ein Budget. Gibt eine Liste von Flugoptionen mit Preis zurück.',
    parameters: travelSearchParameters,
  },
  execute: (input) => ({
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
  }),
};

export const searchHotelsTool: AgentTool<TravelSearchInput> = {
  kind: 'tool',
  definition: {
    name: 'search_hotels',
    description:
      'Sucht Hotels an einem Reiseziel für einen bestimmten Zeitraum und ein Budget. Gibt eine Liste von Hotel-Optionen mit Preis zurück.',
    parameters: travelSearchParameters,
  },
  execute: (input) => ({
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
  }),
};
