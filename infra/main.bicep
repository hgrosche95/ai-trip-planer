targetScope = 'resourceGroup'

@description('Azure-Region für die meisten Ressourcen (Container Apps, Log Analytics).')
param location string = resourceGroup().location

@description('Region für die Static Web App. Static Web Apps sind nur in wenigen Regionen verfügbar, deshalb ein eigener Parameter statt der allgemeinen "location".')
param staticWebAppLocation string = 'eastus2'

@description('Region für den PostgreSQL-Server. Eigener Parameter, weil Azure-Subscriptions (v. a. neue/Trial-Subscriptions) für einzelne Dienste unterschiedliche Regionen sperren können - "location" kann daher für Postgres ungeeignet sein, obwohl sie für andere Ressourcen funktioniert.')
param postgresLocation string = 'swedencentral'

@description('Basis-Name für alle Ressourcen, z. B. "trip-planner-dev". Fließt in global-eindeutige Namen (Postgres-Server, Static Web App) mit ein, daher niedrig halten und ggf. um ein Zufalls-Suffix ergänzen.')
param namePrefix string

@description('Name der Anwendungsdatenbank.')
param databaseName string = 'trip_planner'

@description('Administrator-Benutzername für den PostgreSQL-Server.')
@secure()
param postgresAdminLogin string

@description('Administrator-Passwort für den PostgreSQL-Server.')
@secure()
param postgresAdminPassword string

@description('Vollständige Backend-Image-Referenz, z. B. ghcr.io/<owner>/<repo>-api:<tag>.')
param containerImage string

@description('Benutzername für den GHCR-Login (z. B. GitHub-Benutzer-/Orgname).')
param registryUsername string

@description('Passwort/Token für den GHCR-Login (z. B. ein GitHub PAT mit read:packages).')
@secure()
param registryPassword string

@description('Anthropic-API-Key fürs Backend.')
@secure()
param anthropicApiKey string

module appInsights 'modules/app-insights.bicep' = {
  name: 'app-insights-deployment'
  params: {
    location: location
    namePrefix: namePrefix
  }
}

module postgres 'modules/postgres.bicep' = {
  name: 'postgres-deployment'
  params: {
    location: postgresLocation
    namePrefix: namePrefix
    serverName: '${namePrefix}-psql3'
    databaseName: databaseName
    administratorLogin: postgresAdminLogin
    administratorPassword: postgresAdminPassword
  }
}

// Der eigentliche Connection-String wird hier zusammengesetzt (nicht im postgres-Modul
// ausgegeben), damit das Passwort nie als Modul-Output durch die Deployment-Historie läuft.
// sslmode=require, weil Flexible Server TLS-Verbindungen erzwingt.
var databaseUrl = 'postgresql://${postgresAdminLogin}:${postgresAdminPassword}@${postgres.outputs.serverFqdn}:5432/${databaseName}?sslmode=require'

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
    corsOrigin: 'https://${staticWebApp.outputs.staticWebAppDefaultHostname}'
  }
}

output containerAppUrl string = containerApp.outputs.containerAppUrl
output staticWebAppName string = staticWebApp.outputs.staticWebAppName
output staticWebAppDefaultHostname string = staticWebApp.outputs.staticWebAppDefaultHostname
output postgresServerName string = postgres.outputs.serverName
output postgresServerFqdn string = postgres.outputs.serverFqdn
output postgresDatabaseName string = postgres.outputs.databaseName
