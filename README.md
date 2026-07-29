# AI Trip Planner

KI-gestützter Reiseplaner zum Lernen von Next.js, NestJS, Prisma/PostgreSQL,
echten LLM-Tool-Use-Agent-Workflows und E2E-Testing mit Playwright.

## Struktur

- `apps/web` – Next.js Frontend
- `apps/api` – NestJS Backend (inkl. `prisma/` Schema+Migrations, Prisma-Anbindung und Anthropic-Agent-Logik in `src/`)
- `e2e` – Playwright End-to-End-Tests
- `docker-compose.yml` – lokale PostgreSQL-Instanz
- `.github/workflows` – CI-Pipeline (Lint, Test, Build)

## Lokales Setup

Voraussetzungen: Node.js 20+, Docker Desktop.

1. Abhängigkeiten installieren (installiert automatisch auch den generierten Prisma-Client via `postinstall`):
   ```
   npm install
   ```
2. PostgreSQL starten:
   ```
   docker compose up -d
   ```
3. In `apps/api/.env` den `ANTHROPIC_API_KEY` eintragen (Key aus [console.anthropic.com](https://console.anthropic.com); wird separat vom Claude-Abo abgerechnet).
4. Datenbank-Migrationen anwenden (nur beim allerersten Setup nötig, danach nur bei Schema-Änderungen):
   ```
   cd apps/api && npx prisma migrate dev
   ```
5. Backend starten:
   ```
   npm run start:dev
   ```

## Backend-Endpunkte (`apps/api`)

- `GET /health` – prüft die Datenbankverbindung
- `POST /agent/chat` – Chat mit dem Reiseplaner-Agenten, Body: `{ "sessionId": "...", "message": "..." }`

Gespeicherte Reisepläne lassen sich mit `npx prisma studio` (in `apps/api`) im Browser unter `http://localhost:5555` einsehen.
