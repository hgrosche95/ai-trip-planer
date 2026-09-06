# Trip-Planner MCP-Server

Macht drei Trip-Planner-Fähigkeiten über das [Model Context Protocol](https://modelcontextprotocol.io)
für jeden MCP-Client (Claude Code, Claude Desktop, ...) nutzbar - dieselben
Fähigkeiten, die auch der Chat-Agent in `apps/api` hat, nicht neu
implementiert, sondern über die bestehende NestJS-API bzw. den RAG-Service
aufgerufen.

## Tools

| Tool | Ruft auf | Zweck |
| --- | --- | --- |
| `search_travel_knowledge` | `services/rag` `POST /search` | Faktensuche in der Reiseziel-Wissensbasis |
| `create_itinerary` | `apps/api` `POST /itineraries` | Legt einen neuen Reiseplan mit Tagesprogramm an |
| `list_itineraries` | `apps/api` `GET /itineraries` | Listet alle gespeicherten Reisepläne |

`create_itinerary`/`list_itineraries` brauchen einen JWT gegen `apps/api` -
der Server loggt sich beim ersten Aufruf selbst über `POST /auth/login` ein
(Zugangsdaten aus Env, siehe unten) und cached den Token für die Laufzeit
des Prozesses.

## Warum `@modelcontextprotocol/server` (nicht `@modelcontextprotocol/sdk`)

Vor der Umsetzung geprüft statt angenommen: `@modelcontextprotocol/sdk`
(das ältere, vereinheitlichte Paket) existiert zwar noch auf npm, die
[offizielle Quickstart-Doku](https://modelcontextprotocol.io/quickstart/server)
installiert für neue TypeScript-Server aber `@modelcontextprotocol/server`
(aktuell v2, aufgeteilte Architektur mit `@modelcontextprotocol/core`
darunter) - `McpServer`, `server.registerTool(name, { description,
inputSchema }, handler)` mit Zod-Schemas, `StdioServerTransport` aus
`@modelcontextprotocol/server/stdio`.

## Setup

```bash
# einmalig, im Repo-Root (npm-Workspace)
npm install

cd packages/mcp-server
npm run build
```

### Konfiguration (Env)

| Variable | Default | Zweck |
| --- | --- | --- |
| `TRIP_PLANNER_API_URL` | `http://localhost:3000` | Basis-URL von `apps/api` |
| `TRIP_PLANNER_USERNAME` | – (Pflicht für `create_itinerary`/`list_itineraries`) | Login-Username, wie in `apps/api/.env` |
| `TRIP_PLANNER_PASSWORD` | – (Pflicht für `create_itinerary`/`list_itineraries`) | Login-Passwort im Klartext (das Backend kennt nur den bcrypt-Hash) |
| `RAG_SERVICE_URL` | `http://localhost:8001` | Basis-URL von `services/rag` |

## In Claude Code registrieren

```bash
claude mcp add --transport stdio trip-planner \
  --env TRIP_PLANNER_USERNAME=dein-username \
  --env TRIP_PLANNER_PASSWORD=dein-passwort \
  -- node packages/mcp-server/dist/index.js
```

`--scope project` würde die Konfiguration in einer `.mcp.json` im Repo-Root
ablegen (teilbar via Git) statt in der lokalen, nutzerspezifischen
`~/.claude.json` - für dieses Projekt bewusst nicht gewählt, weil die
Zugangsdaten sonst versehentlich mit eingecheckt werden könnten.

Danach in Claude Code z.B. fragen: *"Nutze das trip-planner MCP-Tool, um
nach Essen in Lissabon zu suchen"* - Claude Code wählt `search_travel_knowledge`
selbst aus.

## Manuell testen (ohne Claude Code)

Der offizielle [Inspector](https://github.com/modelcontextprotocol/inspector)
spricht das Protokoll korrekt, ohne dass man den Handshake von Hand
nachbauen müsste:

```bash
# Tools auflisten
npx -y @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list

# Ein Tool aufrufen
npx -y @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name search_travel_knowledge \
  --tool-arg query="Was kann man in Wien essen?"

# Mit Env-Variablen (Reihenfolge wichtig: -e NACH dem Server-Kommando)
npx -y @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name list_itineraries \
  -e TRIP_PLANNER_USERNAME=dein-username -e TRIP_PLANNER_PASSWORD=dein-passwort
```

## Fehlerhandling

Jedes Tool fängt Fehler (nicht erreichbarer Service, 401, ungültige Eingabe)
ab und gibt sie als MCP-Tool-Ergebnis mit `isError: true` zurück, statt den
Prozess abstürzen zu lassen oder einen rohen Protokollfehler zu werfen - der
aufrufende Client (bzw. das Modell) sieht eine lesbare Fehlermeldung und kann
darauf reagieren.
