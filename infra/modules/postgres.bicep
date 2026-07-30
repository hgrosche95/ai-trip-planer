@description('Azure-Region, in der die Ressourcen angelegt werden.')
param location string

@description('Basis-Name, aus dem die Ressourcennamen abgeleitet werden, z. B. "trip-planner-dev".')
param namePrefix string

@description('Name der Anwendungsdatenbank, die auf dem Server angelegt wird.')
param databaseName string = 'trip_planner'

@description('Administrator-Benutzername für den PostgreSQL-Server.')
@secure()
param administratorLogin string

@description('Administrator-Passwort für den PostgreSQL-Server.')
@secure()
param administratorPassword string

@description('Compute-Tier des Servers. Burstable (B1ms) ist die günstigste Option und ausreichend für ein Lernprojekt mit wenig Last.')
param skuName string = 'Standard_B1ms'

@description('Größe des Speichers in MB. 32 GB ist die kleinste verfügbare Stufe für Flexible Server.')
param storageSizeGB int = 32

@description('PostgreSQL-Major-Version.')
param postgresVersion string = '16'

// Azure Database for PostgreSQL - Flexible Server: ein verwalteter Postgres-Server, bei dem
// Azure Patching, Backups und Failover übernimmt. Burstable-SKUs (B-Serie) sind für
// Workloads mit niedriger/unregelmäßiger Last gedacht und deutlich günstiger als
// General Purpose/Memory Optimized, weil man nur eine "Baseline"-CPU-Leistung gebucht hat
// und kurzzeitig darüber hinaus "bursten" kann.
resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${namePrefix}-psql'
  location: location
  sku: {
    name: skuName
    tier: 'Burstable'
  }
  properties: {
    version: postgresVersion
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    storage: {
      storageSizeGB: storageSizeGB
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

// Die eigentliche Anwendungsdatenbank innerhalb des Servers (ein Server kann mehrere
// Datenbanken hosten, wir brauchen für den Trip Planner nur eine).
resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgresServer
  name: databaseName
}

// Firewall-Regel, die Zugriffe von anderen Azure-Diensten erlaubt (z. B. unsere Container
// App). Der Bereich 0.0.0.0-0.0.0.0 ist eine von Azure reservierte Sonder-Notation, die
// genau das bedeutet: "beliebige Azure-interne Quell-IP", NICHT "das ganze Internet".
resource allowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgresServer
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output serverName string = postgresServer.name
output serverFqdn string = postgresServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
