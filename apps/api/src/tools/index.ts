import type { ExternalCache } from '../external/external-cache';
import { OpenMeteoClient } from '../external/open-meteo.client';
import type { ItinerariesService } from '../itineraries.service';
import { createSaveItineraryTool } from './save-itinerary.tool';
import { showDestinationTool } from './show-destination.tool';
import { ToolRegistry } from './tool-registry';
import { travelKnowledgeTool } from './travel-knowledge.tool';
import { searchFlightsTool, searchHotelsTool } from './travel-search.tools';
import { createWeatherTool } from './weather.tool';

export { ToolRegistry, hasError } from './tool-registry';
export type {
  AgentTool,
  ChatSource,
  GlobeFocus,
  GlobeRoute,
  ToolRun,
  ToolWeather,
} from './tool-registry';

// Alle Tools, die der Chat-Agent nutzen darf. Ein neues Tool: Datei in
// diesem Ordner anlegen und hier eintragen, der AgentService bleibt gleich.
export function createAgentTools(
  itinerariesService: ItinerariesService,
  externalCache: ExternalCache,
): ToolRegistry {
  return new ToolRegistry([
    travelKnowledgeTool,
    searchFlightsTool,
    searchHotelsTool,
    showDestinationTool,
    createWeatherTool(new OpenMeteoClient(externalCache)),
    createSaveItineraryTool(itinerariesService),
  ]);
}
