import 'dotenv/config';
import './tracing';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Genau ein Proxy (Azure-Container-Apps-Ingress) vor der API: ohne diese
  // Einstellung wäre req.ip immer die Proxy-IP, und alle Besucher teilten
  // sich dasselbe Rate-Limit.
  app.set('trust proxy', 1);
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:3001',
  });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
