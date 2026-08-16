import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma.module';
import { HealthModule } from './health.module';
import { AgentModule } from './agent.module';
import { ItinerariesModule } from './itineraries.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AgentModule,
    ItinerariesModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
