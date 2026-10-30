using '../main.bicep'

/**
 * Parámetros de producción.
 *
 * Los secretos NO se escriben aquí: se leen de variables de entorno del shell o
 * del pipeline (`SIGUE_DB_OWNER_PASSWORD`, etc.). Este archivo se versiona.
 *
 *   export SIGUE_DB_OWNER_PASSWORD=...   # 16+ caracteres
 *   export SIGUE_DB_APP_PASSWORD=...     # 16+ caracteres
 *   export SIGUE_JWT_ACCESS_SECRET=...   # 32+ caracteres
 *   export SIGUE_JWT_REFRESH_SECRET=...  # 32+ caracteres
 *   export SIGUE_MFA_ENCRYPTION_KEY=...  # 32+ caracteres, estable
 *   az deployment sub create -l eastus2 -f iac/main.bicep \
 *     -p iac/parameters/prod.bicepparam
 */
param location = 'eastus2'
param namePrefix = 'sigue'
param environment = 'prod'

param dbOwnerPassword = readEnvironmentVariable('SIGUE_DB_OWNER_PASSWORD')
param dbAppPassword = readEnvironmentVariable('SIGUE_DB_APP_PASSWORD')
param jwtAccessSecret = readEnvironmentVariable('SIGUE_JWT_ACCESS_SECRET')
param jwtRefreshSecret = readEnvironmentVariable('SIGUE_JWT_REFRESH_SECRET')
param mfaEncryptionKey = readEnvironmentVariable('SIGUE_MFA_ENCRYPTION_KEY')

// Se fija tras el primer despliegue: es el FQDN que asigna Container Apps.
// En el primer apply se puede dejar vacío y pasar el valor real en el segundo.
param webOrigin = readEnvironmentVariable('SIGUE_WEB_ORIGIN', 'https://localhost')

param apiImageTag = readEnvironmentVariable('SIGUE_API_IMAGE_TAG', 'latest')
param webImageTag = readEnvironmentVariable('SIGUE_WEB_IMAGE_TAG', 'latest')

param dbSku = 'Standard_B2s'
