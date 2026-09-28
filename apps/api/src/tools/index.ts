import type { ExternalCache } from '../external/external-cache';
import { FrankfurterClient } from '../external/frankfurter.client';
import { OpenMeteoClient } from '../external/open-meteo.client';
import { OverpassClient } from '../external/overpass.client';
import type { ItinerariesService } from '../itineraries.service';
import { createCurrencyTool } from './currency.tool';
import { createLodgingTool } from './lodging.tool';
import { createSaveItineraryTool } from './save-itinerary.tool';
import { showDestinationTool } from './show-destination.tool';
import { ToolRegistry } from './tool-registry';
import { travelKnowledgeTool } from './travel-knowledge.tool';
import { createTransportEstimateTool } from './transport-estimate.tool';
import { createWeatherTool } from './weather.tool';

export { ToolRegistry, hasError } from './tool-registry';
export type {
  AgentTool,
  ChatSource,
  GlobeFocus,
  GlobeRoute,
  ToolLodging,
  ToolRun,
  ToolWeather,
} from './tool-registry';

// Alle Tools, die der Chat-Agent nutzen darf. Ein neues Tool: Datei in
// diesem Ordner anlegen und hier eintragen, der AgentService bleibt gleich.
export function createAgentTools(
  itinerariesService: ItinerariesService,
  externalCache: ExternalCache,
): ToolRegistry {
  // Ein Open-Meteo-Client für alle Tools: Geocoding von Wetter, Unterkünften
  // und Anreise teilt sich so die Cache-Einträge.
  const openMeteo = new OpenMeteoClient(externalCache);
  return new ToolRegistry([
    travelKnowledgeTool,
    showDestinationTool,
    createWeatherTool(openMeteo),
    createLodgingTool(openMeteo, new OverpassClient(externalCache)),
    createTransportEstimateTool(openMeteo),
    createCurrencyTool(new FrankfurterClient(externalCache)),
    createSaveItineraryTool(itinerariesService),
  ]);
}
