import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { searchTravelKnowledge } from './rag-client';

interface SearchKnowledgeBody {
  query: string;
}

@Controller('knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  @Post('search')
  search(@Body() body: SearchKnowledgeBody) {
    return searchTravelKnowledge(body.query);
  }
}
