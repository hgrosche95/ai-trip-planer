# Trip-Planner MCP-Server

Macht drei Trip-Planner-Fähigkeiten über das [Model Context Protocol](https://modelcontextprotocol.io)
für jeden MCP-Client (Claude Code, Claude Desktop, ...) nutzbar - dieselben
Fähigkeiten, die auch der Chat-Agent hat, nicht neu implementiert, sondern
über die bestehende NestJS-API (`apps/api`) aufgerufen. Der MCP-Server
spricht ausschließlich mit `apps/api`, nie direkt mit `services/rag` - siehe
"Warum alle drei Tools über apps/api laufen" unten.

## Tools

| Tool | Ruft auf | Zweck |
| --- | --- | --- |
| `search_travel_knowledge` | `apps/api` `POST /knowledge/search` | Faktensuche in der Reiseziel-Wissensbasis |
| `create_itinerary` | `apps/api` `POST /itineraries` | Legt einen neuen Reiseplan mit Tagesprogramm an |
| `list_itineraries` | `apps/api` `GET /itineraries` | Listet alle gespeicherten Reisepläne |

Alle drei Tools brauchen einen JWT gegen `apps/api` - der Server loggt sich
beim ersten Aufruf selbst über `POST /auth/login` ein (Zugangsdaten aus Env,
siehe unten) und cached den Token für die Laufzeit des Prozesses.

## Warum alle drei Tools über apps/api laufen

`search_travel_knowledge` rief früher `services/rag` direkt auf
(`RAG_SERVICE_URL`). Das funktioniert nur, solange der MCP-Server
Netzwerk-Nähe zu `services/rag` hat - lokal der Fall, aber nicht mehr, sobald
der HTTP-Transport dort läuft, wo dieses README ihn eigentlich bewirbt: "ein
zentral gehosteter Server, den mehrere Teammitglieder/Clients remote
nutzen". Im Azure-Deployment (siehe [docs/deployment.md](../../docs/deployment.md))
ist `services/rag` bewusst **nicht** öffentlich erreichbar
(`ingress.external: false`) - nur `apps/api` erreicht es intern über seinen
Namen. Ein extern gehosteter MCP-Server hätte also für genau dieses eine
Tool ins Leere gezeigt.

Der Fix: `search_travel_knowledge` ruft jetzt denselben `POST
/knowledge/search`-Endpunkt in `apps/api` auf, der intern
`rag-client.ts`/`searchTravelKnowledge()` nutzt - exakt dieselbe Funktion,
die auch der Chat-Agent für dieses Tool aufruft. `RAG_SERVICE_URL` und
`src/rag-client.ts` sind damit aus dem MCP-Server komplett verschwunden; er
braucht nur noch `TRIP_PLANNER_API_URL` und ist dadurch tatsächlich remote
hostbar, ohne je Zugriff auf das interne Netz der Container Apps Environment
zu brauchen.

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
| `TRIP_PLANNER_USERNAME` | – (Pflicht für alle drei Tools) | Login-Username, wie in `apps/api/.env` |
| `TRIP_PLANNER_PASSWORD` | – (Pflicht für alle drei Tools) | Login-Passwort im Klartext (das Backend kennt nur den bcrypt-Hash) |
| `MCP_HTTP_TOKEN` | – (Pflicht für den HTTP-Transport) | Bearer-Token, das Clients im `Authorization`-Header mitschicken müssen |
| `MCP_HTTP_PORT` | `8787` | Port des HTTP-Transports |

## Zwei Transporte - welcher wofür

| | stdio (`npm start`) | HTTP (`npm run start:http`) |
| --- | --- | --- |
| Wie gestartet | Client startet den Server als eigenen Kindprozess | Server läuft eigenständig, Clients verbinden sich über das Netzwerk |
| Wer kann verbinden | Nur Prozesse auf demselben Rechner, unter derselben Nutzer-Session | Jeder, der den Host + Port + Bearer-Token hat |
| Auth nötig? | Nein - die Prozessgrenze selbst ist die Absicherung | Ja, zwingend (siehe unten) |
| Typischer Einsatz | Claude Code, Claude Desktop lokal | Ein zentral gehosteter Server, den mehrere Teammitglieder/Clients remote nutzen |

**Warum ein Agenten-Endpunkt ohne Auth gefährlich ist:** stdio ist implizit
abgesichert, weil nur startet, wer schon lokale Ausführungsrechte hat - bei
HTTP fällt dieser Schutz weg, der Endpunkt ist netzwerkweit erreichbar.
Ohne Auth könnte **jeder**, der die URL kennt (oder errät/scannt), Reisepläne
in der echten Datenbank anlegen und die Wissensbasis durchsuchen - bei einem
Tool-Server mit schreibenden Aktionen (hier: `create_itinerary`) ist das
nicht nur ein Informationsleck, sondern ein Weg, fremde Daten zu manipulieren.
Der HTTP-Transport verweigert deshalb **jede** Anfrage ohne gültigen
`Authorization: Bearer <MCP_HTTP_TOKEN>`-Header mit `401`, umgesetzt über
den SDK-eigenen `requireBearerAuth`-Helfer (`src/bearer-auth.ts`) - ein
statisches Shared-Secret-Token statt einer vollen OAuth-Integration, weil
das für ein einzelnes selbst betriebenes Deployment die angemessene
Komplexität ist.

**Welches Tool bewusst nicht exponiert ist:** `apps/api` hat einen
`DELETE /itineraries/:id`-Endpunkt, aber es gibt absichtlich **kein**
`delete_itinerary`-MCP-Tool. In einem Unternehmenskontext würde ich jedes
Tool mit einer destruktiven, nicht umkehrbaren Aktion (Löschen, aber auch
z.B. das Versenden von E-Mails oder Zahlungsauslösung) grundsätzlich nicht
ohne separate Freigabe/Bestätigungsschritt exponieren - ein MCP-Tool kann
von einem Modell autonom aufgerufen werden, ein Tippfehler in der
Nutzeranfrage oder eine Fehlinterpretation des Modells sollte niemals genügen,
um unwiderruflich Daten zu verlieren.

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

# Ein Tool aufrufen (alle drei brauchen einen Login, siehe oben - Reihenfolge
# wichtig: -e NACH dem Server-Kommando)
npx -y @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name search_travel_knowledge \
  --tool-arg query="Was kann man in Wien essen?" \
  -e TRIP_PLANNER_USERNAME=dein-username -e TRIP_PLANNER_PASSWORD=dein-passwort

npx -y @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call --tool-name list_itineraries \
  -e TRIP_PLANNER_USERNAME=dein-username -e TRIP_PLANNER_PASSWORD=dein-passwort
```

## HTTP-Transport starten & testen

```bash
MCP_HTTP_TOKEN=dein-geheimes-token npm run start:http
```

```bash
# Ohne Token -> 401
curl -i -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Mit Token -> Tools-Liste (über den offiziellen Inspector, spricht das
# Streamable-HTTP-Protokoll korrekt statt raw JSON-RPC per curl)
npx -y @modelcontextprotocol/inspector --cli --transport http \
  --server-url http://localhost:8787/mcp \
  --header "Authorization: Bearer dein-geheimes-token" --method tools/list
```

## Fehlerhandling

Jedes Tool fängt Fehler (nicht erreichbarer Service, 401, ungültige Eingabe)
ab und gibt sie als MCP-Tool-Ergebnis mit `isError: true` zurück, statt den
Prozess abstürzen zu lassen oder einen rohen Protokollfehler zu werfen - der
aufrufende Client (bzw. das Modell) sieht eine lesbare Fehlermeldung und kann
darauf reagieren.
