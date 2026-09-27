# apps/api – NestJS-Backend

Agent-Schleife, Tools, Reisepläne und Auth des AI Trip Planners. Setup,
Umgebungsvariablen und alle Endpunkte stehen in der
[Haupt-README](../../README.md#backend-endpunkte-appsapi).

- `src/agent.service.ts` – Tool-Loop: LLM mit `tools`-Array aufrufen, Tool-Calls einer Runde parallel ausführen, Ergebnisse zurückgeben (max. 5 Runden pro Nachricht), Langfuse-Tracing ohne Freitext
- `src/tools/` – `ToolRegistry` und die Tools des Agenten: `search_flights`/`search_hotels` (simuliert), `search_travel_knowledge` (RAG), `save_itinerary`, `show_destination_on_globe`
- `src/llm/` – `LlmProvider`-Interface mit Groq- und Anthropic-Adapter, Retry-Wrapper, Chat-Verlauf in Postgres (`conversation-store.ts`, Löschung nach `CONVERSATION_RETENTION_DAYS`, Standard 30)
- `src/auth/` – Besitzer-Login und anonyme Gast-Tokens (JWT)
- `src/itineraries.*`, `src/knowledge.controller.ts` – REST für Reisepläne und Wissenssuche (auch vom MCP-Server genutzt)
- `prisma/` – Schema und Migrationen

```bash
npm run start:dev    # Port 3000, braucht .env (siehe .env.example) und Postgres aus docker compose
npm run test
npm run lint
```
