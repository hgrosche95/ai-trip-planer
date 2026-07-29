import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

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
}