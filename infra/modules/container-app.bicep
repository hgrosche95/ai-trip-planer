@description('Azure-Region, in der die Ressourcen angelegt werden.')
param location string

@description('Basis-Name, aus dem die Ressourcennamen abgeleitet werden, z. B. "trip-planner-dev".')
param namePrefix string

@description('Name des Log Analytics Workspace (aus dem app-insights-Modul), muss in derselben Resource Group liegen.')
param logAnalyticsWorkspaceName string

@description('Application Insights Connection String, wird als Secret an den Container weitergereicht.')
@secure()
param appInsightsConnectionString string

@description('Vollständige Image-Referenz, z. B. ghcr.io/<owner>/<repo>-api:<tag>.')
param containerImage string

@description('Registry-Server, von dem das Image gezogen wird.')
param registryServer string = 'ghcr.io'

@description('Benutzername für den Registry-Login (z. B. GitHub-Benutzer-/Orgname).')
param registryUsername string

@description('Passwort/Token für den Registry-Login (z. B. ein GitHub PAT mit read:packages).')
@secure()
param registryPassword string

@description('Postgres-Connection-String fürs Backend, wird als Secret an den Container weitergereicht.')
@secure()
param databaseUrl string

@description('Anthropic-API-Key fürs Backend, wird als Secret an den Container weitergereicht.')
@secure()
param anthropicApiKey string

@description('Ursprung (Origin) des Frontends, den das Backend per CORS zulässt, z. B. https://<static-web-app>.azurestaticapps.net.')
param corsOrigin string

@description('Minimale Anzahl Replicas. 0 = Scale-to-Zero, spart Kosten in Ruhephasen.')
param minReplicas int = 0

@description('Maximale Anzahl Replicas.')
param maxReplicas int = 3

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

// Container Apps Environment: die "Kubernetes-artige" Laufzeitumgebung, in der eine oder
// mehrere Container Apps gemeinsam laufen (vergleichbar mit einem AKS-Cluster, nur
// vollständig verwaltet - man sieht keine Nodes, kein kubectl). Eine Environment ist an
// genau einen Log Analytics Workspace gebunden, dorthin fließen Container-Logs/Stdout.
resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${namePrefix}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

// Die Container App selbst: beschreibt, welches Image läuft, mit welchen Ressourcen,
// welchen Umgebungsvariablen/Secrets, und wie sie skaliert.
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-api'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      // "external: true" macht die App über eine öffentliche HTTPS-URL erreichbar
      // (nötig, damit das Static Web App-Frontend sie ansprechen kann).
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      // Alle sensiblen Werte laufen über "secrets" statt als Klartext in "env" zu stehen.
      // Container Apps verschlüsselt sie at-rest und maskiert sie in Logs/Portal.
      secrets: [
        {
          name: 'registry-password'
          value: registryPassword
        }
        {
          name: 'database-url'
          value: databaseUrl
        }
        {
          name: 'anthropic-api-key'
          value: anthropicApiKey
        }
        {
          name: 'appinsights-connection-string'
          value: appInsightsConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImage
          resources: {
            // Kleinstmögliche Container-Apps-Größe - reicht für eine NestJS-API mit
            // wenig gleichzeitigem Traffic locker aus und hält die Kosten niedrig.
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }
            {
              name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
              secretRef: 'appinsights-connection-string'
            }
            { name: 'PORT', value: '3000' }
            { name: 'CORS_ORIGIN', value: corsOrigin }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
      }
    }
  }
}

output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
