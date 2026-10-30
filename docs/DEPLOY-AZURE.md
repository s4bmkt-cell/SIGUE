# Despliegue en Azure (producción)

Guía de primera puesta en producción de SIGUE sobre Azure Container Apps. Está
escrita para ejecutarse en orden, de arriba abajo, y dejar el sistema operable.

Los pasos marcados **⟨una vez⟩** se hacen una sola vez por suscripción; los
demás se repiten en cada despliegue (y ya están automatizados en
`.github/workflows/deploy.yml`).

---

## 0. Qué se crea

| Recurso | Nombre | Para qué |
|---|---|---|
| Resource group | `rg-sigue-prod` | Contenedor de todo |
| Container Registry | `acrsigueprod` | Imágenes de API y web |
| PostgreSQL Flexible Server | `pg-sigue-prod` | Base de datos (`sigue`) |
| Storage Account | `stsigueprod` | Evidencias (Blob privado) |
| Key Vault | `kv-sigue-prod` | Secretos de la API |
| Container Apps Environment | `cae-sigue-prod` | Ejecución de contenedores |
| Container App API | `ca-sigue-prod-api` | NestJS, **solo red interna** |
| Container App web | `ca-sigue-prod-web` | Next.js, expuesta a Internet |
| Job de migraciones | `job-sigue-prod-migrate` | `prisma migrate deploy` + rol `sigue_app` |
| Log Analytics | `log-sigue-prod` | Logs y métricas |

La API **no** es accesible desde Internet: la web la alcanza por la red interna
del entorno y sirve de proxy same-origin (`/api/*`). Así las cookies de sesión
siguen siendo `httpOnly` + `SameSite=Lax` sin CORS de por medio.

---

## 1. Requisitos ⟨una vez⟩

```bash
az login
az account set --subscription "<id-suscripción>"
az bicep install          # 0.48 o superior
az provider register --namespace Microsoft.App
az provider register --namespace Microsoft.DBforPostgreSQL
az provider register --namespace Microsoft.KeyVault
```

Comprueba que tienes rol **Contributor** en la suscripción (o en un resource
group concreto, ajustando `scope`).

---

## 2. Identidad para GitHub Actions (OIDC) ⟨una vez⟩

Sin secretos de larga vida en GitHub: el workflow se autentica con federación.

```bash
APP_NAME="sigue-github-deploy"

az ad app create --display-name "$APP_NAME"
APP_ID=$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)

# Service principal
az ad sp create --id "$APP_ID"
SP_ID=$(az ad sp show --id "$APP_ID" --query id -o tsv)

# Permiso para desplegar en la suscripción
az role assignment create \
  --assignee "$SP_ID" \
  --role Contributor \
  --scope /subscriptions/<id-suscripción>

# Credencial federada: solo el repo y la rama indicados pueden asumirla
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:<org>/<repo>:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

Guarda `APP_ID`, el tenant y la suscripción como secretos del repositorio en
GitHub → *Settings → Secrets and variables → Actions*:

| Secreto | Valor |
|---|---|
| `AZURE_CLIENT_ID` | `APP_ID` |
| `AZURE_TENANT_ID` | id de tenant (`az account show --query tenantId -o tsv`) |
| `AZURE_SUBSCRIPTION_ID` | id de suscripción |
| `SIGUE_DB_OWNER_PASSWORD` | contraseña del rol dueño (16+ caracteres) |
| `SIGUE_DB_APP_PASSWORD` | contraseña del rol de aplicación (16+ caracteres) |
| `SIGUE_JWT_ACCESS_SECRET` | 32+ caracteres aleatorios |
| `SIGUE_JWT_REFRESH_SECRET` | 32+ caracteres aleatorios **distintos** |
| `SIGUE_MFA_ENCRYPTION_KEY` | 32+ caracteres, **estable para siempre** |

Y una variable de repositorio:

| Variable | Valor |
|---|---|
| `SIGUE_WEB_ORIGIN` | URL pública de la web (p. ej. `https://app.sigue.mx`) |

> La primera vez la URL aún no existe: usa un marcador (`https://localhost`) y
> repite el despliegue con el valor real cuando Azure asigne el FQDN.

Para generar los secretos:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## 3. Primer despliegue

Con los secretos ya cargados, lanza el workflow **Deploy (Azure Container Apps)**
desde *Actions → Run workflow*, o hazlo a mano:

```bash
export SIGUE_DB_OWNER_PASSWORD=...
export SIGUE_DB_APP_PASSWORD=...
export SIGUE_JWT_ACCESS_SECRET=...
export SIGUE_JWT_REFRESH_SECRET=...
export SIGUE_MFA_ENCRYPTION_KEY=...
export SIGUE_WEB_ORIGIN=https://localhost

az deployment sub create \
  --location eastus2 \
  --template-file iac/main.bicep \
  --parameters iac/parameters/prod.bicepparam

# Imágenes
ACR=$(az deployment sub show -n sigue-main --query properties.outputs.registryLoginServer.value -o tsv)
az acr login --name "${ACR%%.*}"
docker build -f apps/api/Dockerfile -t "$ACR/sigue-api:v1" .
docker build -f apps/web/Dockerfile -t "$ACR/sigue-web:v1" .
docker push "$ACR/sigue-api:v1"
docker push "$ACR/sigue-web:v1"

# Migraciones (job único; crea tablas y el rol sigue_app con RLS forzado)
az containerapp job start -n job-sigue-prod-migrate -g rg-sigue-prod
```

Espera a que el job termine en estado `Succeeded`:

```bash
az containerapp job execution list \
  -n job-sigue-prod-migrate -g rg-sigue-prod \
  --query '[0].{status:properties.status,start:properties.startTime}' -o table
```

---

## 4. Verificación

```bash
WEB=$(az deployment sub show -n sigue-main --query properties.outputs.webUrl.value -o tsv)
echo "$WEB"

curl -s "$WEB/api/v1/health"
# {"status":"ok","service":"sigue-api",...}
```

Comprobaciones mínimas antes de abrir a usuarios:

1. `https://<web>/api/v1/health` responde `200`.
2. `https://<web>/login` carga y autentica con un usuario real.
3. En el portal de la base, `sigue_app` **no** ve filas sin contexto:
   ```sql
   SELECT count(*) FROM "Document";   -- 0 con el rol de la aplicación
   ```
4. Un usuario de la organización A recibe 403 al pedir `/orgs/<orgB>/documents`.
5. `az containerapp logs show -n ca-sigue-prod-api -g rg-sigue-prod --tail 50`
   no muestra errores de arranque.

---

## 5. Datos iniciales

En producción **no** se ejecuta `npm run db:seed`: ese seed crea usuarios con la
contraseña pública `demo-password`. El catálogo normativo sí es necesario, así
que se carga aparte:

```bash
# Desde una máquina con acceso a la base (o un job efímero con la imagen de la API)
DIRECT_URL="postgresql://sigue:<clave>@pg-sigue-prod.postgres.database.azure.com:5432/sigue?sslmode=require" \
  npm run db:catalog --workspace @sigue/api
```

Después, crea la primera organización y su administrador desde la API:

```bash
curl -X POST "https://<web>/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Administrador","email":"admin@tu-dominio.mx","password":"<clave-fuerte>"}'
```

> La cuenta queda sin organización: la primera organización se crea por
> invitación o con un script de aprovisionamiento. Ver `docs/RUNBOOK.md` § 9.

---

## 6. Certificado y dominio propio

Container Apps emite un certificado para `*.azurecontainerapps.io`. Para un
dominio propio:

```bash
az containerapp hostname add -g rg-sigue-prod -n ca-sigue-prod-web \
  --hostname app.sigue.mx

# Crea el CNAME/TXT que indica el comando anterior y luego:
az containerapp hostname bind -g rg-sigue-prod -n ca-sigue-prod-web \
  --hostname app.sigue.mx \
  --environment cae-sigue-prod \
  --validation-method CNAME

# Actualiza SIGUE_WEB_ORIGIN y vuelve a desplegar: CORS y enlaces de correo
# usan ese valor.
```

---

## 7. Actualizaciones y marcha atrás

- **Actualizar**: push a `main` → el workflow compila, publica imágenes con el
  SHA y reinicia las réplicas. El job de migraciones corre antes del reinicio.
- **Marcha atrás**: vuelve a desplegar un SHA anterior (`workflow_dispatch` con
  el commit antiguo). Las migraciones de Prisma son de solo avance: si el cambio
  incluyó una migración destructiva, restaura el respaldo en lugar de revertir.
- **Respaldo**: PostgreSQL Flexible Server hace copias automáticas con retención
  de 14 días (definido en `iac/modules/resources.bicep`). Restauración a un
  punto en el tiempo:
  ```bash
  az postgres flexible-server restore \
    --resource-group rg-sigue-prod \
    --name pg-sigue-prod-restored \
    --source-server pg-sigue-prod \
    --restore-time 2026-10-18T03:00:00Z
  ```

---

## 8. Costos

Estimación con SKU base (eastus2, precios de referencia — verifica en la
calculadora de Azure):

| Recurso | Configuración | Costo mensual aprox. |
|---|---|---|
| PostgreSQL Flexible | B2s, 32 GB, HA desactivada | ~$60 |
| Container Apps | 2 apps, 1 réplica, 0.5 vCPU / 1 GiB | ~$25 |
| ACR Basic | 10 GB | ~$5 |
| Storage ZRS | 10 GB + operaciones | ~$3 |
| Key Vault | < 10 000 operaciones | ~$1 |
| Log Analytics | 5 GB/mes | ~$15 |
| **Total** | | **≈ $110/mes** |

Se reduce a la mitad desactivando Log Analytics de retención extendida o usando
PostgreSQL `B1ms` (adecuado hasta ~20 usuarios concurrentes).

---

## 9. Qué no está cubierto aquí

- **Postmark** (correo transaccional): el adaptador está tras `MailerPort`.
  Mientras no se configure, los correos se escriben en el log y en el sistema de
  archivos del contenedor (efímero). Para activarlo hay que registrar el
  adaptador y añadir `POSTMARK_TOKEN` en Key Vault.
- **Stripe**: igual que el correo. El adaptador local no cobra; el cambio de plan
  lo aplica el servidor cuando llega un webhook firmado.
- **WAF / Front Door**: Container Apps no incluye WAF. Si necesitas protección
  de borde, coloca Azure Front Door o Application Gateway por delante.
- **Alta disponibilidad de la base**: el Bicep usa `highAvailability: Disabled`.
  Para producción crítica, cambia a `ZoneRedundant` (duplica el costo de la BD).
