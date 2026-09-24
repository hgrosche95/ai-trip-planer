import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { searchCareerKnowledge, searchTravelKnowledge } from './rag-client';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from './auth/current-user';

class SearchKnowledgeBody {
  @IsString()
  @Length(1, 500)
  query!: string;
  // Default "travel" statt Pflichtfeld: bestehende Aufrufer (z.B. der
  // Chat-Agent, der Trip-Planner-MCP-Server) schicken heute kein
  // collection-Feld mit und sollen unverändert Reise-Ergebnisse bekommen.
  @IsOptional()
  @IsIn(['travel', 'jobs'])
  collection?: 'travel' | 'jobs';
}

// Reisewissen darf jeder abfragen (auch Gäste), die jobs-Collection ist für
// persönliches Karrierewissen gedacht und bleibt dem Besitzer vorbehalten.
@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  @Post('search')
  search(@CurrentUser() user: AuthUser, @Body() body: SearchKnowledgeBody) {
    if (body.collection === 'jobs') {
      if (user.role !== 'owner') {
        throw new ForbiddenException('Nur für den Besitzer');
      }
      return searchCareerKnowledge(body.query);
    }
    return searchTravelKnowledge(body.query);
  }
}
