import { Body, Controller, Post } from '@nestjs/common';
import { searchCareerKnowledge, searchTravelKnowledge } from './rag-client';

interface SearchKnowledgeBody {
  query: string;
  // Default "travel" statt Pflichtfeld: bestehende Aufrufer (z.B. der
  // Chat-Agent, der Trip-Planner-MCP-Server) schicken heute kein
  // collection-Feld mit und sollen unverändert Reise-Ergebnisse bekommen.
  collection?: 'travel' | 'jobs';
}

// Kein Login-Zwang mehr, siehe itineraries.controller.ts.
@Controller('knowledge')
export class KnowledgeController {
  @Post('search')
  search(@Body() body: SearchKnowledgeBody) {
    return body.collection === 'jobs'
      ? searchCareerKnowledge(body.query)
      : searchTravelKnowledge(body.query);
  }
}
