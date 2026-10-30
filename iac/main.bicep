targetScope = 'subscription'

/**
 * SIGUE — infraestructura de producción en Azure.
 *
 * Qué crea:
 *  - Resource group
 *  - Azure Container Registry (ACR) para las imágenes de API y web
 *  - PostgreSQL Flexible Server con dos roles (dueño y aplicación con RLS)
 *  - Storage Account (evidencias) sin acceso público
 *  - Key Vault para los secretos de la API (JWT, MFA, conexión)
 *  - Log Analytics + Container Apps Environment
 *  - Container App de API y Container App de web
 *
 * Decisiones:
 *  - La API y la web se comunican por la red interna del entorno de Container
 *    Apps (`ingress.external: false` en la API): la API nunca se expone a
 *    Internet, solo la web.
 *  - Sin contraseñas en el entorno de los contenedores: los secretos viven en
 *    Key Vault y se inyectan como secretos de Container Apps.
 *  - Las identidades administradas de las apps reciben solo los roles que
 *    necesitan (Key Vault Secrets User, Storage Blob Data Contributor, AcrPull).
 *
 * Uso:
 *   az deployment sub create \
 *     --location eastus2 \
 *     --template-file iac/main.bicep \
 *     --parameters iac/parameters/prod.bicepparam
 */
param location string = 'eastus2'
param namePrefix string = 'sigue'
param environment string = 'prod'

@secure()
@description('Contraseña del rol dueño de la base (migraciones y seed).')
@minLength(16)
param dbOwnerPassword string

@secure()
@description('Contraseña del rol de aplicación (sujeto a RLS).')
@minLength(16)
param dbAppPassword string

@secure()
@description('Secreto JWT de acceso (mínimo 32 caracteres).')
@minLength(32)
param jwtAccessSecret string

@secure()
@description('Secreto JWT de refresh (mínimo 32 caracteres).')
@minLength(32)
param jwtRefreshSecret string

@secure()
@description('Clave estable para cifrar las semillas TOTP (mínimo 32 caracteres).')
@minLength(32)
param mfaEncryptionKey string

@description('URL pública de la web (para CORS). Ej. https://app.sigue.mx')
@minLength(8)
param webOrigin string

@description('Imágenes publicadas por CI (tag inmutable, p. ej. el SHA del commit).')
param apiImageTag string = 'latest'
param webImageTag string = 'latest'

@description('SKU de PostgreSQL Flexible Server.')
@allowed(['Standard_B1ms', 'Standard_B2s', 'Standard_D2ds_v5'])
param dbSku string = 'Standard_B2s'

var suffix = '${namePrefix}-${environment}'
var rgName = 'rg-${suffix}'
var tags = {
  application: 'SIGUE'
  environment: environment
  managedBy: 'bicep'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-07-01' = {
  name: rgName
  location: location
  tags: tags
}

module infra 'modules/resources.bicep' = {
  scope: rg
  name: 'sigue-resources'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    tags: tags
    dbOwnerPassword: dbOwnerPassword
    dbAppPassword: dbAppPassword
    jwtAccessSecret: jwtAccessSecret
    jwtRefreshSecret: jwtRefreshSecret
    mfaEncryptionKey: mfaEncryptionKey
    webOrigin: webOrigin
    apiImageTag: apiImageTag
    webImageTag: webImageTag
    dbSku: dbSku
  }
}

output resourceGroupName string = rgName
output apiUrl string = 'https://${infra.outputs.apiFqdn}'
output webUrl string = 'https://${infra.outputs.webFqdn}'
output registryLoginServer string = infra.outputs.registryLoginServer
output postgresHost string = infra.outputs.postgresHost
output postgresDatabase string = infra.outputs.postgresDatabase
output keyVaultName string = infra.outputs.keyVaultName
output apiAppName string = infra.outputs.apiAppName
output webAppName string = infra.outputs.webAppName
output migrateJobName string = infra.outputs.migrateJobName
