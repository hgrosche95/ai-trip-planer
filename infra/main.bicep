targetScope = 'resourceGroup'

@description('Azure-Region für die meisten Ressourcen (Container Apps, Log Analytics).')
param location string = resourceGroup().location

@description('Region für die Static Web App. Static Web Apps sind nur in wenigen Regionen verfügbar, deshalb ein eigener Parameter statt der allgemeinen "location".')
param staticWebAppLocation string = 'eastus2'

@description('Basis-Name für alle Ressourcen, z. B. "trip-planner-dev". Fließt in global-eindeutige Namen (Static Web App) mit ein, daher niedrig halten und ggf. um ein Zufalls-Suffix ergänzen.')
param namePrefix string

@description('Vollständige Backend-Image-Referenz, z. B. ghcr.io/<owner>/<repo>-api:<tag>.')
param containerImage string

@description('Benutzername für den GHCR-Login (z. B. GitHub-Benutzer-/Orgname).')
param registryUsername string

@description('Passwort/Token für den GHCR-Login (z. B. ein GitHub PAT mit read:packages).')
@secure()
param registryPassword string

@description('Fertiger Postgres-Connection-String fürs Backend (z. B. von Neon), inkl. sslmode=require. Wird komplett von außen übergeben statt aus einzelnen Azure-Postgres-Parametern zusammengesetzt, weil die Datenbank nicht mehr von diesem Template provisioniert wird.')
@secure()
param databaseUrl string

@description('Anthropic-API-Key fürs Backend (Fallback-Provider, siehe LLM_PROVIDER).')
@secure()
param anthropicApiKey string

@description('Groq-API-Key fürs Backend (Standard-Provider, kostenloses Tier).')
@secure()
param groqApiKey string

@description('Username fürs Login gegen /auth/login.')
param authUsername string

@description('bcrypt-Hash des Login-Passworts (nicht das Passwort selbst!).')
@secure()
param authPasswordHash string

@description('Geheimer Schlüssel, mit dem das Backend JWTs signiert/verifiziert.')
@secure()
param jwtSecret string

module appInsights 'modules/app-insights.bicep' = {
  name: 'app-insights-deployment'
  params: {
    location: location
    namePrefix: namePrefix
  }
}

module staticWebApp 'modules/static-web-app.bicep' = {
  name: 'static-web-app-deployment'
  params: {
    location: staticWebAppLocation
    namePrefix: namePrefix
  }
}

module containerApp 'modules/container-app.bicep' = {
  name: 'container-app-deployment'
  params: {
    location: location
    namePrefix: namePrefix
    logAnalyticsWorkspaceName: appInsights.outputs.logAnalyticsWorkspaceName
    appInsightsConnectionString: appInsights.outputs.appInsightsConnectionString
    containerImage: containerImage
    registryUsername: registryUsername
    registryPassword: registryPassword
    databaseUrl: databaseUrl
    anthropicApiKey: anthropicApiKey
    groqApiKey: groqApiKey
    corsOrigin: 'https://${staticWebApp.outputs.staticWebAppDefaultHostname}'
    authUsername: authUsername
    authPasswordHash: authPasswordHash
    jwtSecret: jwtSecret
  }
}

output containerAppUrl string = containerApp.outputs.containerAppUrl
output staticWebAppName string = staticWebApp.outputs.staticWebAppName
output staticWebAppDefaultHostname string = staticWebApp.outputs.staticWebAppDefaultHostname
