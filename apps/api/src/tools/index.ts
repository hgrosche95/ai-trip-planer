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
import type { AgentTool } from './tool-registry';
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

// Jedes Tool genau einmal erzeugt. Der Classic-Agent bekommt alle in einer
// ToolRegistry (createAgentTools), die Agenten des Orchestrators je eine
// eigene Registry mit ihrer Teilmenge (orchestrator/orchestrator.factory.ts).
export interface AgentToolSet {
  knowledge: AgentTool;
  showDestination: AgentTool;
  weather: AgentTool;
  lodging: AgentTool;
  transport: AgentTool;
  currency: AgentTool;
  saveItinerary: AgentTool;
}

export function createToolSet(
  itinerariesService: ItinerariesService,
  externalCache: ExternalCache,
): AgentToolSet {
  // Ein Open-Meteo-Client für alle Tools: Geocoding von Wetter, Unterkünften
  // und Anreise teilt sich so die Cache-Einträge.
  const openMeteo = new OpenMeteoClient(externalCache);
  return {
    knowledge: travelKnowledgeTool,
    showDestination: showDestinationTool,
    weather: createWeatherTool(openMeteo),
    lodging: createLodgingTool(openMeteo, new OverpassClient(externalCache)),
    transport: createTransportEstimateTool(openMeteo),
    currency: createCurrencyTool(new FrankfurterClient(externalCache)),
    saveItinerary: createSaveItineraryTool(itinerariesService),
  };
}

// Alle Tools, die der Chat-Agent nutzen darf. Ein neues Tool: Datei in
// diesem Ordner anlegen und in createToolSet() eintragen, der AgentService
// bleibt gleich.
export function createAgentTools(
  itinerariesService: ItinerariesService,
  externalCache: ExternalCache,
): ToolRegistry {
  const tools = createToolSet(itinerariesService, externalCache);
  return new ToolRegistry([
    tools.knowledge,
    tools.showDestination,
    tools.weather,
    tools.lodging,
    tools.transport,
    tools.currency,
    tools.saveItinerary,
  ]);
}
