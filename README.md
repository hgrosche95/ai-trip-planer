# AI Trip Planner

KI-gestützter Reiseplaner zum Lernen von Next.js, NestJS, Prisma/PostgreSQL,
echten LLM-Tool-Use-Agent-Workflows und E2E-Testing mit Playwright.

## Struktur

- `apps/web` – Next.js Frontend (Chat-Oberfläche + Reiseplan-Anzeige unter `/trips`), als statischer Export gebaut
- `apps/api` – NestJS Backend (inkl. `prisma/` Schema+Migrations, Prisma-Anbindung und Anthropic-Agent-Logik in `src/`), `Dockerfile` für den produktiven Container
- `e2e` – Playwright End-to-End-Tests
- `infra` – Bicep-Templates für das Azure-Deployment (siehe [Architektur](#architektur-azure))
- `docker-compose.yml` – lokale PostgreSQL-Instanz
- `.github/workflows` – CI-Pipeline (Lint, Test, Build, E2E) und Azure-Deployment-Workflow

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

## Architektur (Azure) <a name="architektur-azure"></a>

Das Projekt lässt sich per Infrastructure-as-Code (Bicep, `infra/`) nach Azure deployen:

```
                 ┌──────────────────────────────┐
                 │   GitHub Actions (CI/CD)      │
                 │   .github/workflows/deploy.yml│
                 │   Login via OIDC              │
                 └───────────────┬────────────────┘
                                 │
                 ┌───────────────┼────────────────────────────┐
                 │               ▼                             │
                 │   docker push          az deployment group  │
                 │       │                    create           │
                 ▼       │                       │              │
   ghcr.io (Backend-Image)                       ▼              │
                 │                 Azure Resource Group          │
                 │        ┌─────────────────────────────────┐   │
                 └───────▶│ Container Apps Environment       │   │
                          │   └─ Container App (NestJS API)  │   │
                          │        │              │           │  │
                          │        │              └─────▶ Application Insights
                          │        │                          │       ▲
                          │        ▼                          │       │
                          │  PostgreSQL Flexible Server        │  Log Analytics
                          │  (Burstable B1ms, Firewall:        │   Workspace
                          │   nur Azure-interne Dienste)        │
                          └─────────────────────────────────┘   │
                                        ▲                        │
                                        │ NEXT_PUBLIC_API_URL     │
                          ┌──────────────────────┐               │
              Browser ───▶│ Static Web App (Free)│───────────────┘
                          │ Next.js, statischer   │
                          │ Export aus apps/web    │
                          └──────────────────────┘
```

| Dienst | Zweck |
| --- | --- |
| **Azure Static Web Apps** | Hosting des Next.js-Frontends als statischer Export (HTML/JS/CSS, globales CDN, kostenloses TLS) |
| **Azure Container Apps** | Laufzeitumgebung fürs NestJS-Backend, Scale-to-Zero (keine Kosten im Leerlauf) |
| **Azure Database for PostgreSQL – Flexible Server** | Verwaltete Postgres-Datenbank, Burstable-Tier (günstigste SKU) |
| **Application Insights + Log Analytics** | Monitoring/Logs des Backends (Connection-String ist als Secret hinterlegt; die App selbst sendet aktuell noch keine Telemetrie – dafür müsste noch das Application-Insights-SDK in `apps/api` eingebunden werden) |
| **GitHub Container Registry (ghcr.io)** | Hostet das Backend-Docker-Image |

Alle Ressourcen werden über `infra/main.bicep` (bindet die Module aus `infra/modules/` ein) in einer einzigen Resource Group angelegt.

### Deployment einrichten

Voraussetzungen: ein Azure-Account/-Subscription, [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) und die Bicep-CLI (`az bicep install`).

**1. Azure AD App-Registrierung für den OIDC-Login (einmalig):**

```bash
az ad app create --display-name "ai-trip-planner-deploy"
# App-ID (Client-ID) und Tenant-ID notieren, z. B.:
az account show --query tenantId -o tsv
```

Danach im Azure-Portal (oder per `az ad app federated-credential create`) für diese App eine **Federated Credential** anlegen, die dem GitHub-Actions-OIDC-Token von `push`-Events auf `main` in diesem Repo vertraut (Subject: `repo:<owner>/<repo>:ref:refs/heads/main`). Der App anschließend die Rolle `Contributor` auf die Ziel-Subscription/Resource-Group zuweisen:

```bash
az role assignment create \
  --assignee <APP_CLIENT_ID> \
  --role Contributor \
  --scope /subscriptions/<SUBSCRIPTION_ID>
```

Falls Federated Credentials im eigenen Tenant nicht eingerichtet werden können: alternativ einen Service Principal mit Secret anlegen (`az ad sp create-for-rbac`) und statt `client-id`/`tenant-id`/`subscription-id` einen `AZURE_CREDENTIALS`-Secret mit dem `azure/login`-Action-Parameter `creds:` verwenden – weniger sicher (langlebiger Schlüssel), aber ein funktionierender Fallback.

**2. Folgende Secrets im Repo anlegen** (Settings → Secrets and variables → Actions):

| Secret | Zweck |
| --- | --- |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | OIDC-Login gegen Azure |
| `POSTGRES_ADMIN_LOGIN`, `POSTGRES_ADMIN_PASSWORD` | Zugangsdaten für den Postgres Flexible Server |
| `ANTHROPIC_API_KEY` | für den Agenten im Backend (existiert vermutlich schon aus der CI-Pipeline) |
| `GHCR_PAT` | GitHub Personal Access Token mit Scope `read:packages` – wird als Registry-Pull-Credential in die Container App geschrieben (das kurzlebige `GITHUB_TOKEN` reicht dafür nicht, siehe Kommentar in `deploy.yml`) |

**3. Deployen:** Push auf `main` (oder manuell über den "Run workflow"-Button bei `deploy.yml`) baut das Backend-Image, deployt die Bicep-Templates und veröffentlicht das Frontend – alles automatisch.

Region/Namens-Präfix lassen sich in `infra/main.parameters.json` anpassen.

### Kosten im Blick behalten

Die Konfiguration ist bewusst auf die günstigsten Optionen ausgelegt (Container Apps Scale-to-Zero, Postgres Burstable-Tier, Static Web Apps Free-Tier, gedeckelte Log-Analytics-Aufnahme) – trotzdem läuft der **PostgreSQL Flexible Server nicht automatisch in einen Nullkosten-Zustand**, wenn er nicht benutzt wird (anders als die Container App). Wer länger pausiert, sollte ihn manuell stoppen:

```bash
az postgres flexible-server stop --name <server-name> --resource-group trip-planner-dev-rg
```

Ein gestoppter Server startet sich nach 7 Tagen automatisch wieder (Azure-Limit) – bei längeren Pausen den Befehl ggf. wiederholen, oder die Ressourcen bei Nichtgebrauch mit `az group delete` komplett entfernen (dann müsste vor dem nächsten Deployment allerdings `npx prisma migrate deploy` erneut laufen, da eine neue, leere Datenbank entsteht).
