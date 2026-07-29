# AI Trip Planner

KI-gestützter Reiseplaner zum Lernen von Next.js, NestJS, Prisma/PostgreSQL,
echten LLM-Tool-Use-Agent-Workflows und E2E-Testing mit Playwright.

## Struktur

- `apps/web` – Next.js Frontend (Chat-Oberfläche + Reiseplan-Anzeige unter `/trips`)
- `apps/api` – NestJS Backend (inkl. `prisma/` Schema+Migrations, Prisma-Anbindung und Anthropic-Agent-Logik in `src/`)
- `e2e` – Playwright End-to-End-Tests
- `docker-compose.yml` – lokale PostgreSQL-Instanz
- `.github/workflows` – CI-Pipeline (Lint, Test, Build, E2E)

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
5. Backend starten (Port 3000):
   ```
   cd apps/api && npm run start:dev
   ```
6. Frontend starten (Port 3001, in einem zweiten Terminal; braucht `apps/web/.env.local` mit `NEXT_PUBLIC_API_URL=http://localhost:3000`):
   ```
   cd apps/web && npm run dev
   ```
7. Chat unter `http://localhost:3001`, gespeicherte Reisen unter `http://localhost:3001/trips`.

## Backend-Endpunkte (`apps/api`)

- `GET /health` – prüft die Datenbankverbindung
- `POST /agent/chat` – Chat mit dem Reiseplaner-Agenten, Body: `{ "sessionId": "...", "message": "..." }`
- `GET /itineraries` – Liste aller gespeicherten Reisen
- `GET /itineraries/:id` – Details einer Reise inkl. Tagesplan-Punkte
- `DELETE /itineraries/:id` – löscht eine Reise (inkl. ihrer Programmpunkte)
- `DELETE /itineraries/:id/stops/:stopId` – löscht einen einzelnen Programmpunkt

Gespeicherte Reisepläne lassen sich auch mit `npx prisma studio` (in `apps/api`) im Browser unter `http://localhost:5555` einsehen.

## E2E-Tests (`e2e`)

Playwright-Test, der den kompletten Flow gegen den echten Chat-Agenten prüft (Backend, Frontend und Postgres müssen laufen):

```
cd e2e && npx playwright test
```

Läuft auch automatisch in der CI-Pipeline (eigener `e2e`-Job mit Postgres-Service-Container und dem `ANTHROPIC_API_KEY`-Repository-Secret).
