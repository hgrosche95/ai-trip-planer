import type { ItinerariesService } from '../itineraries.service';
import { createSaveItineraryTool } from './save-itinerary.tool';
import { showDestinationTool } from './show-destination.tool';
import { ToolRegistry } from './tool-registry';
import { travelKnowledgeTool } from './travel-knowledge.tool';
import { searchFlightsTool, searchHotelsTool } from './travel-search.tools';

export { ToolRegistry } from './tool-registry';
export type {
  AgentTool,
  ChatSource,
  GlobeFocus,
  ToolRun,
} from './tool-registry';

// Alle Tools, die der Chat-Agent nutzen darf. Ein neues Tool: Datei in
// diesem Ordner anlegen und hier eintragen, der AgentService bleibt gleich.
export function createAgentTools(
  itinerariesService: ItinerariesService,
): ToolRegistry {
  return new ToolRegistry([
    travelKnowledgeTool,
    searchFlightsTool,
    searchHotelsTool,
    showDestinationTool,
    createSaveItineraryTool(itinerariesService),
  ]);
}
