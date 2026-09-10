import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createItinerary, listItineraries, searchTravelKnowledge } from './api-client.js';
import type { CreateItineraryInput } from './api-client.js';

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

/**
 * Registriert alle drei Trip-Planner-Tools auf einer McpServer-Instanz -
 * von beiden Transporten (stdio in index.ts, HTTP in http-server.ts)
 * genutzt, damit die Tool-Definitionen nicht zweimal gepflegt werden
 * müssen. Bewusst NICHT dabei: ein "delete_itinerary"-Tool, obwohl
 * apps/api dafür einen Endpunkt hat - siehe README, Abschnitt
 * Sicherheitsüberlegungen.
 */
export function registerTools(server: McpServer): void {
  server.registerTool(
    'search_travel_knowledge',
    {
      description:
        'Durchsucht die kuratierte Wissensbasis zu Reisezielen (Sehenswürdigkeiten, Essen & Trinken, Transport) nach Fakten. Ruft dieselbe Trip-Planner-API auf, die auch der Chat-Agent nutzt (intern an den RAG-Service weitergereicht) - kein topK-Parameter, die Trefferzahl ist zentral in apps/api konfiguriert.',
      inputSchema: z.object({
        query: z
          .string()
          .min(1)
          .describe('Die Suchanfrage, z.B. "Was kann man in Lissabon essen?"'),
      }),
    },
    async ({ query }) => {
      try {
        return jsonContent(await searchTravelKnowledge(query));
      } catch (error) {
        return errorContent('Durchsuchen der Wissensbasis', error);
      }
    },
  );

  server.registerTool(
    'create_itinerary',
    {
      description:
        'Legt einen neuen Reiseplan mit Tagesprogramm über die Trip-Planner-API an - dieselbe Datenbank, die auch der Chat-Agent und das Web-Frontend nutzen.',
      inputSchema: CreateItinerarySchema,
    },
    async (input) => {
      try {
        return jsonContent(await createItinerary(input as CreateItineraryInput));
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
}
