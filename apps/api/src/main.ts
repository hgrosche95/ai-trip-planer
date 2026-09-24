import 'dotenv/config';
import './tracing';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Genau ein Proxy (Azure-Container-Apps-Ingress) vor der API: ohne diese
  // Einstellung wäre req.ip immer die Proxy-IP, und alle Besucher teilten
  // sich dasselbe Rate-Limit.
  app.set('trust proxy', 1);
  // Prüft jeden Body, dessen Typ eine DTO-Klasse mit class-validator-Regeln
  // ist (z.B. CreateItineraryDto), und antwortet bei Verstößen mit 400 statt
  // später mit einer 500 aus Prisma. whitelist entfernt unbekannte Felder,
  // statt den Request abzulehnen (der MCP-Server bleibt so kompatibel).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
