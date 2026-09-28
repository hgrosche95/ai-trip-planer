import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { HealthService } from './health.service';
import { warmUpRag } from './rag-client';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async check() {
    const isDatabaseUp = await this.healthService.checkDatabase();
    return {
      status: isDatabaseUp ? 'ok' : 'error',
      database: isDatabaseUp ? 'connected' : 'unreachable',
    };
  }

  // Ohne Login wie /health: Das Frontend ruft es beim Öffnen des Chats auf,
  // bevor ein Token existiert. Kostet kein LLM-Aufruf, nur einen Weckruf an
  // den RAG-Service, und warmUpRag() schickt höchstens einen pro Minute.
  @Post('warmup')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  warmUp() {
    return { rag: warmUpRag() ? 'waking' : 'recently-woken' };
  }
}
