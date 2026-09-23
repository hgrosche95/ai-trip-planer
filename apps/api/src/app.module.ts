import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { HealthModule } from './health.module';
import { AgentModule } from './agent.module';
import { ItinerariesModule } from './itineraries.module';
import { KnowledgeModule } from './knowledge.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // Großzügiges Grundlimit pro IP für alle Routen; teure Routen (Chat,
    // Login, Gast-Anlage) setzen per @Throttle engere Grenzen.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    HealthModule,
    AgentModule,
    ItinerariesModule,
    KnowledgeModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
