/**
 * Recursos de SIGUE en un resource group.
 *
 * Orden de dependencias:
 *   Log Analytics → Container Apps Environment → Container Apps
 *   ACR → Container Apps (imágenes)
 *   Key Vault → secretos → Container Apps
 *   PostgreSQL → secretos de conexión → Container Apps
 *
 * Las identidades son administradas por el sistema y reciben roles mínimos:
 *  - AcrPull sobre el registro (para descargar la imagen).
 *  - Key Vault Secrets User sobre el almacén (para leer los secretos).
 *  - Storage Blob Data Contributor sobre la cuenta (evidencias).
 */
param namePrefix string
param environment string
param location string
param tags object

@secure()
param dbOwnerPassword string

@secure()
param dbAppPassword string

@secure()
param jwtAccessSecret string

@secure()
param jwtRefreshSecret string

@secure()
param mfaEncryptionKey string
param webOrigin string
param apiImageTag string
param webImageTag string
param dbSku string

var suffix = '${namePrefix}-${environment}'
var registryName = replace('acr${namePrefix}${environment}', '-', '')
var appEnvironmentName = 'cae-${suffix}'
var apiAppName = 'ca-${suffix}-api'
var webAppName = 'ca-${suffix}-web'
var storageName = replace('st${namePrefix}${environment}', '-', '')
var kvName = 'kv-${suffix}'
var pgName = 'pg-${suffix}'
var pgDatabase = 'sigue'
// El administrador del servidor (`azure_pg_admin`) es dueño de las tablas y el
// rol que usan migraciones y seed. El rol de aplicación (`sigue_app`) lo crea
// `npm run db:setup-role` después del despliegue: Prisma no gestiona roles.
var pgAdminUser = 'sigue'
var pgAppUser = 'sigue_app'

// ===== Observabilidad =====
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

// ===== Registro de imágenes =====
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

// ===== Base de datos =====
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgName
  location: location
  tags: tags
  sku: {
    name: dbSku
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminUser
    administratorLoginPassword: dbOwnerPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: 14
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      // Permite las conexiones de los servicios de Azure (Container Apps) sin
      // abrir la base a Internet. El tráfico sigue exigiendo TLS.
      publicNetworkAccess: 'Enabled'
    }
  }
}

resource pgDb 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: pgDatabase
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Solo servicios de Azure (0.0.0.0 es la convención de la plataforma).
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'allow-azure-services'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ===== Almacenamiento de evidencias =====
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_ZRS' }
  properties: {
    // Los archivos solo se sirven a través de la API, que valida la membresía.
    allowBlobPublicAccess: false
    // Sin claves compartidas: la API usa identidad administrada.
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource evidencesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'evidences'
  properties: {
    publicAccess: 'None'
  }
}

// ===== Secretos =====
resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    networkAcls: {
      defaultAction: 'Allow'
      bypass: 'AzureServices'
    }
  }
}

var pgHost = '${pgName}.postgres.database.azure.com'
var ownerConnection = 'postgresql://${pgAdminUser}:${dbOwnerPassword}@${pgHost}:5432/${pgDatabase}?schema=public&sslmode=require'
var appConnection = 'postgresql://${pgAppUser}:${dbAppPassword}@${pgHost}:5432/${pgDatabase}?schema=public&sslmode=require'

resource secretDbApp 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'db-app-connection'
  properties: { value: appConnection }
}

resource secretDbOwner 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'db-owner-connection'
  properties: { value: ownerConnection }
}

resource secretDbAppPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'db-app-password'
  properties: { value: dbAppPassword }
}

resource secretJwtAccess 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'jwt-access-secret'
  properties: { value: jwtAccessSecret }
}

resource secretJwtRefresh 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'jwt-refresh-secret'
  properties: { value: jwtRefreshSecret }
}

resource secretMfaKey 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: vault
  name: 'mfa-encryption-key'
  properties: { value: mfaEncryptionKey }
}

// ===== Job de migraciones =====
// Se ejecuta una vez por despliegue, antes de que las réplicas nuevas arranquen.
// Usa el rol dueño (`DIRECT_URL`) porque aplica DDL y provisiona `sigue_app`.
// Comparte la imagen de la API: los scripts de Prisma viajan con ella.
resource migrateJob 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-${suffix}-migrate'
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    environmentId: appEnvironment.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
      secrets: [
        { name: 'db-owner-connection', keyVaultUrl: '${vault.properties.vaultUri}secrets/db-owner-connection', identity: 'system' }
        { name: 'db-app-password', keyVaultUrl: '${vault.properties.vaultUri}secrets/db-app-password', identity: 'system' }
      ]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: '${acr.properties.loginServer}/sigue-api:${apiImageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          command: [
            'sh'
            '-c'
            // `migrate deploy` aplica las migraciones pendientes; el script de
            // roles queda idempotente y fuerza RLS en las tablas nuevas.
            'npx prisma migrate deploy --schema prisma/schema.prisma && node prisma/setup-app-role.mjs'
          ]
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'DIRECT_URL', secretRef: 'db-owner-connection' }
            { name: 'DATABASE_URL', secretRef: 'db-owner-connection' }
            // `db:setup-role` crea `sigue_app`; ambos roles comparten base.
            { name: 'DATABASE_URL_ADMIN', secretRef: 'db-owner-connection' }
            { name: 'APP_DB_PASSWORD', secretRef: 'db-app-password' }
            { name: 'APP_DB_OWNER', value: pgAdminUser }
            { name: 'APP_DB_NAME', value: pgDatabase }
          ]
        }
      ]
    }
  }
}

// ===== Entorno de Container Apps =====
resource appEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: appEnvironmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

// ===== API =====
resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: apiAppName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      // Solo accesible desde dentro del entorno: la web es la única puerta.
      ingress: {
        external: false
        targetPort: 3001
        transport: 'http'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
      secrets: [
        { name: 'db-app-connection', keyVaultUrl: '${vault.properties.vaultUri}secrets/db-app-connection', identity: 'system' }
        { name: 'jwt-access-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/jwt-access-secret', identity: 'system' }
        { name: 'jwt-refresh-secret', keyVaultUrl: '${vault.properties.vaultUri}secrets/jwt-refresh-secret', identity: 'system' }
        { name: 'mfa-encryption-key', keyVaultUrl: '${vault.properties.vaultUri}secrets/mfa-encryption-key', identity: 'system' }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: '${acr.properties.loginServer}/sigue-api:${apiImageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3001' }
            { name: 'CORS_ORIGINS', value: webOrigin }
            { name: 'WEB_APP_URL', value: webOrigin }
            { name: 'DATABASE_URL', secretRef: 'db-app-connection' }
            { name: 'JWT_ACCESS_SECRET', secretRef: 'jwt-access-secret' }
            { name: 'JWT_REFRESH_SECRET', secretRef: 'jwt-refresh-secret' }
            { name: 'MFA_ENCRYPTION_KEY', secretRef: 'mfa-encryption-key' }
            { name: 'MFA_ISSUER', value: 'SIGUE' }
            { name: 'STORAGE_DRIVER', value: 'azure' }
            { name: 'AZURE_STORAGE_ACCOUNT_URL', value: 'https://${storage.name}.blob.${az.environment().suffixes.storage}' }
            { name: 'AZURE_STORAGE_CONTAINER', value: 'evidences' }
            { name: 'MAX_UPLOAD_MB', value: '25' }
            { name: 'TRUST_PROXY', value: '1' }
          ]
          probes: [
            {
              type: 'liveness'
              httpGet: { path: '/api/v1/health', port: 3001, scheme: 'HTTP' }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
            {
              type: 'readiness'
              httpGet: { path: '/api/v1/health', port: 3001, scheme: 'HTTP' }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      // Una réplica evita que dos contenedores compitan por migraciones o por
      // la cola de correo; el escalado horizontal es seguro (sin estado local).
      scale: {
        minReplicas: 1
        maxReplicas: 3
        rules: [
          {
            name: 'http-rps'
            http: {
              metadata: { concurrentRequests: '50' }
            }
          }
        ]
      }
    }
  }
}

// ===== Web =====
resource webApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: webAppName
  location: location
  tags: tags
  identity: { type: 'SystemAssigned' }
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'http'
        allowInsecure: true
      }
      registries: [
        {
          server: acr.properties.loginServer
          identity: 'system'
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: '${acr.properties.loginServer}/sigue-web:${webImageTag}'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'PORT', value: '3000' }
            { name: 'HOSTNAME', value: '0.0.0.0' }
            // Se resuelve en tiempo de ejecución (route handler del proxy).
            { name: 'API_INTERNAL_URL', value: 'http://${apiApp.properties.configuration.ingress.fqdn}' }
          ]
          probes: [
            {
              type: 'liveness'
              httpGet: { path: '/', port: 3000, scheme: 'HTTP' }
              initialDelaySeconds: 20
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
        rules: [
          {
            name: 'http-rps'
            http: {
              metadata: { concurrentRequests: '100' }
            }
          }
        ]
      }
    }
  }
}

// ===== Permisos de las identidades =====
resource acrPullApi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, apiApp.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource acrPullWeb 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, webApp.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource acrPullJob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, migrateJob.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
    principalId: migrateJob.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsJob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, migrateJob.id, 'KeyVaultSecretsUser')
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: migrateJob.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource kvSecretsApi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(vault.id, apiApp.id, 'KeyVaultSecretsUser')
  scope: vault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource blobContributorApi 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, apiApp.id, 'StorageBlobDataContributor')
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
    principalId: apiApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output registryLoginServer string = acr.properties.loginServer
output apiFqdn string = apiApp.properties.configuration.ingress.fqdn
output webFqdn string = webApp.properties.configuration.ingress.fqdn
output apiPrincipalId string = apiApp.identity.principalId
output webPrincipalId string = webApp.identity.principalId
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output postgresDatabase string = pgDatabase
output keyVaultName string = vault.name
output storageAccountName string = storage.name
output logAnalyticsName string = logs.name
output apiAppName string = apiApp.name
output migrateJobName string = migrateJob.name
output webAppName string = webApp.name
