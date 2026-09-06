import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { createItinerary, listItineraries } from './api-client.js';
import type { CreateItineraryInput } from './api-client.js';
import { searchTravelKnowledge } from './rag-client.js';

const server = new McpServer({ name: 'trip-planner', version: '0.1.0' });

function errorContent(action: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Fehler beim ${action}: ${message}` }],
    isError: true,
  };
}

function jsonContent(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

server.registerTool(
  'search_travel_knowledge',
  {
    description:
      'Durchsucht die kuratierte Wissensbasis zu Reisezielen (Sehenswürdigkeiten, Essen & Trinken, Transport) nach Fakten. Ruft denselben RAG-Service auf, den auch der Chat-Agent nutzt.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe('Die Suchanfrage, z.B. "Was kann man in Lissabon essen?"'),
      topK: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe('Anzahl der Treffer (Default 5)'),
    }),
  },
  async ({ query, topK }) => {
    try {
      return jsonContent(await searchTravelKnowledge(query, topK));
    } catch (error) {
      return errorContent('Durchsuchen der Wissensbasis', error);
    }
  },
);

const StopCategorySchema = z.enum([
  'FOOD',
  'CULTURE',
  'SIGHTSEEING',
  'ACCOMMODATION',
  'TRANSPORT',
  'OTHER',
]);

const CreateItinerarySchema = z.object({
  destination: z.string().min(1).describe('Zielort, z.B. "Lissabon"'),
  startDate: z.string().describe('Anreisedatum, Format YYYY-MM-DD'),
  endDate: z.string().describe('Abreisedatum, Format YYYY-MM-DD'),
  budgetCents: z.number().int().nonnegative().describe('Gesamtbudget in Cent'),
  currency: z.string().optional().describe('z.B. EUR, Default EUR'),
  preferences: z.array(z.string()).optional(),
  stops: z
    .array(
      z.object({
        dayNumber: z.number().int().min(1),
        order: z.number().int().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        category: StopCategorySchema.optional(),
        costCents: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .describe('Programmpunkte des Reiseplans'),
});

server.registerTool(
  'create_itinerary',
  {
    description:
      'Legt einen neuen Reiseplan mit Tagesprogramm über die Trip-Planner-API an - dieselbe Datenbank, die auch der Chat-Agent und das Web-Frontend nutzen.',
    inputSchema: CreateItinerarySchema,
  },
  async (input) => {
    try {
      return jsonContent(
        await createItinerary(input as CreateItineraryInput),
      );
    } catch (error) {
      return errorContent('Anlegen des Reiseplans', error);
    }
  },
);

server.registerTool(
  'list_itineraries',
  {
    description: 'Listet alle gespeicherten Reisepläne mit ihren Eckdaten auf.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      return jsonContent(await listItineraries());
    } catch (error) {
      return errorContent('Auflisten der Reisepläne', error);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Trip-Planner MCP-Server läuft (stdio)');
}

main().catch((error) => {
  console.error('Fataler Fehler beim Start des MCP-Servers:', error);
  process.exit(1);
});
