import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { searchCareerKnowledge, searchTravelKnowledge } from './rag-client';

interface SearchKnowledgeBody {
  query: string;
  // Default "travel" statt Pflichtfeld: bestehende Aufrufer (z.B. der
  // Chat-Agent, der Trip-Planner-MCP-Server) schicken heute kein
  // collection-Feld mit und sollen unverändert Reise-Ergebnisse bekommen.
  collection?: 'travel' | 'jobs';
}

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  @Post('search')
  search(@Body() body: SearchKnowledgeBody) {
    return body.collection === 'jobs'
      ? searchCareerKnowledge(body.query)
      : searchTravelKnowledge(body.query);
  }
}
