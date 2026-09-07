@description('Azure-Region, in der die Ressource angelegt wird.')
param location string

@description('Basis-Name, aus dem der Ressourcenname abgeleitet wird, z. B. "trip-planner-dev".')
param namePrefix string

@description('Name der bestehenden Container Apps Environment (aus dem container-app-Modul), in der auch das Backend läuft - beide Apps müssen in derselben Environment liegen, damit sie sich über ihren Namen erreichen können.')
param containerAppEnvironmentName string

@description('Vollständige RAG-Image-Referenz, z. B. ghcr.io/<owner>/<repo>-rag:<tag>.')
param containerImage string

@description('Registry-Server, von dem das Image gezogen wird.')
param registryServer string = 'ghcr.io'

@description('Benutzername für den Registry-Login (z. B. GitHub-Benutzer-/Orgname).')
param registryUsername string

@description('Passwort/Token für den Registry-Login (z. B. ein GitHub PAT mit read:packages).')
@secure()
param registryPassword string

@description('Postgres-Connection-String für den RAG-Service, OHNE das ?schema=public-Suffix - psycopg (anders als Prisma) kennt diesen Query-Parameter nicht.')
@secure()
param databaseUrl string

@description('Minimale Anzahl Replicas. 0 = Scale-to-Zero, spart Kosten in Ruhephasen.')
param minReplicas int = 0

@description('Maximale Anzahl Replicas.')
param maxReplicas int = 3

resource containerAppEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: containerAppEnvironmentName
}

resource ragContainerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${namePrefix}-rag'
  location: location
  properties: {
    managedEnvironmentId: containerAppEnvironment.id
    configuration: {
      // external: false - der RAG-Service hat keine eigene Auth (/search und
      // /embed sind offen, siehe Sicherheitsabschnitt in
      // packages/mcp-server/README.md für dieselbe Klasse von Überlegung),
      // darf also nie vom öffentlichen Internet aus erreichbar sein.
      // Innerhalb derselben Container Apps Environment erreicht apps/api ihn
      // trotzdem über seinen kurzen Namen (http://<name>, siehe
      // RAG_SERVICE_URL im container-app-Modul) - dafür braucht es kein
      // eigenes virtuelles Netzwerk.
      ingress: {
        external: false
        targetPort: 8001
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
      secrets: [
        {
          name: 'registry-password'
          value: registryPassword
        }
        {
          name: 'database-url'
          value: databaseUrl
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'rag'
          image: containerImage
          resources: {
            // Nächste erlaubte Stufe über der API (0.25 vCPU/0.5Gi, siehe
            // container-app.bicep): das RAG-Image ist ~330 MiB inkl.
            // vorgeladenem Embedding-Modell (Phase 3.4) und braucht beim
            // Laden mehr Kopfraum als die schlanke NestJS-API.
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: [
            { name: 'DATABASE_URL', secretRef: 'database-url' }
          ]
          // readiness statt nur des Container-Apps-Standard-TCP-Checks:
          // /health schlägt schon heute fehl, solange das Embedding-Modell
          // in FastAPIs lifespan noch lädt (siehe main.py) - kein neuer
          // Code nötig, nur diese Verdrahtung, damit Container Apps in der
          // Zeit keinen Traffic dorthin schickt.
          probes: [
            {
              type: 'readiness'
              httpGet: {
                path: '/health'
                port: 8001
              }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
            {
              type: 'liveness'
              httpGet: {
                path: '/health'
                port: 8001
              }
              initialDelaySeconds: 10
              periodSeconds: 30
            }
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

output ragContainerAppName string = ragContainerApp.name
