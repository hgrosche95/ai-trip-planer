@description('Azure-Region. Static Web Apps sind nur in einer begrenzten Auswahl an Regionen verfügbar (z. B. westeurope).')
param location string

@description('Basis-Name, aus dem der Ressourcenname abgeleitet wird, z. B. "trip-planner-dev".')
param namePrefix string

// Azure Static Web Apps: Hosting für statische Frontends (HTML/JS/CSS), inkl. globalem CDN
// und kostenlosem TLS-Zertifikat. Der Free-Tier reicht für ein Lernprojekt völlig aus.
//
// Wir verzichten hier bewusst auf die GitHub-Repo-Verknüpfung (repositoryUrl/branch), die
// Azure sonst nutzt, um automatisch einen eigenen Workflow zu generieren - stattdessen baut
// und deployt unser eigener Workflow (.github/workflows/deploy.yml) das Frontend, und nutzt
// dafür ein Deployment-Token, das wir zur Laufzeit per `az staticwebapp secrets list`
// abrufen (nicht als Bicep-Output, damit das Token nicht im Klartext in der
// Deployment-Historie landet).
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${namePrefix}-web'
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    buildProperties: {
      appLocation: '/apps/web'
      outputLocation: 'out'
    }
  }
}

output staticWebAppName string = staticWebApp.name
output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
