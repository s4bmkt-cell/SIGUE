# Subidas grandes: Azure Blob con URL firmada

## El problema

La web publica `/api/*` como **función serverless en Vercel**, y una función de
Vercel corta el cuerpo de la petición en **4,5 MB**. Como el proxy de Next
reenvía el archivo a la API sin tocarlo, el límite de la plataforma se convertía
en el límite real de subida, aunque la API admita 25 MB.

Además, en Render con el plan gratuito el disco es **efímero**: los archivos
guardados con `STORAGE_DRIVER=local` desaparecen en cada despliegue o reinicio.

Ambas cosas se resuelven igual: el binario **no pasa por la web ni por la API**.
El navegador pide permiso a la API, recibe una URL firmada y sube el archivo
directo a Azure Blob. La API solo guarda los metadatos.

```
navegador ──1. POST .../files/ticket──▶ API ──firma──▶ devuelve URL + key
          ──2. PUT (archivo)──────────▶ Azure Blob
          ──3. POST .../files/confirm─▶ API ──stat + fila──▶ DB
```

## Qué cambia en el comportamiento

| | `local` (disco) | `azure` (Blob) |
|---|---|---|
| Tope por archivo | 4 MB (el proxy) | 250 MB (`MAX_DIRECT_UPLOAD_MB`) |
| Persistencia | Se pierde al desplegar | Persistente |
| Descarga | Por la API (`GET …/download`) | Por la API, igual |
| Archivos públicos | No | No: la cuenta no expone acceso público |

El tope lo informa `GET /api/v1/orgs/:orgId/documents/upload-capabilities`, y la
web lo usa para validar antes de enviar. Si el almacenamiento es `local` ese
endpoint devuelve `direct: false` y la subida sigue siendo multipart.

## Puesta en marcha

### 1. Cuenta de almacenamiento

En Azure Portal → **Storage accounts** → *Create*:

- **Rendimiento**: Standard
- **Redundancia**: LRS (o ZRS si quieres tolerancia de zona)
- **Acceso público a blobs**: **deshabilitado** (la API sirve los archivos)
- **Soft delete**: activado, 7 días, para recuperar borrados accidentales

Anota el nombre de la cuenta; la URL queda
`https://<cuenta>.blob.core.windows.net`.

### 2. Contenedor

Container → **sigue-files** (o el que declares en `AZURE_STORAGE_CONTAINER`).
Nivel de acceso: **Private**.

### 3. Entidad de servicio

La API corre fuera de Azure, así que `DefaultAzureCredential` no puede usar
identidad administrada: se usa una entidad de servicio.

```bash
az ad sp create-for-rbac --name sigue-api-storage --skip-assignment
```

Guarda `appId`, `password` y `tenant`.

### 4. Permiso sobre la cuenta

El rol **Storage Blob Data Contributor** permite leer, escribir y borrar, y
además incluye la acción `Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey`
que necesita `presignPut` para firmar.

> **La asignación va a nivel de cuenta de almacenamiento, no del contenedor.**
> `generateUserDelegationKey` actúa sobre la cuenta entera: si el rol se asigna
> solo al contenedor, la descarga funciona pero la subida directa falla con 403
> al pedir la clave de delegación. Para limitar el alcance al contenedor habría
> que añadir además **Storage Blob Delegator** en la cuenta; una sola asignación
> en la cuenta es más simple y suficiente.

```bash
ACCOUNT=siguefiles
RG=rg-sigue
SP=<appId del paso 3>

az role assignment create \
  --assignee "$SP" \
  --role "Storage Blob Data Contributor" \
  --scope "$(az storage account show -n $ACCOUNT -g $RG --query id -o tsv)"
```

El rol tarda unos minutos en propagarse. En el portal: cuenta de almacenamiento →
**Control de acceso (IAM)** → pestaña **Asignaciones de roles**, con el ámbito
**Este recurso**, debe aparecer `sigue-api-storage` con ese rol.

### 5. CORS en el servicio Blob

**Este paso es imprescindible y es el que más se olvida.** El navegador sube el
archivo desde `https://sigue-web.vercel.app` a
`https://<cuenta>.blob.core.windows.net`: es otro origen, y un `PUT` con
`x-ms-blob-type` y `Content-Type` no es una petición simple, así que el navegador
manda primero un `OPTIONS` (preflight). Si Blob no tiene una regla CORS que lo
acepte, el preflight responde **403** y la subida nunca sale del navegador
—aunque la SAS sea válida y el rol esté bien—.

Cuenta de almacenamiento → menú izquierdo **Configuración → Recursos
compartidos (CORS)** → pestaña **Blob** → añade una fila y pulsa **Guardar**:

| Campo | Valor |
|---|---|
| Orígenes permitidos | `https://sigue-web.vercel.app` |
| Métodos permitidos | `PUT` |
| Encabezados permitidos | `x-ms-blob-type, content-type` |
| Encabezados expuestos | `etag, x-ms-request-id` |
| Antigüedad máxima | `3600` |

Si el portal te muestra los campos en inglés: *Allowed origins*, *Allowed
methods*, *Allowed headers*, *Exposed headers*, *Max age*.

Reglas:

- El origen debe coincidir **exacto**, con esquema y sin barra final. Para
  pruebas locales añade una segunda fila con `http://localhost:3000` (son hasta
  5 reglas por servicio). No uses `*` en producción: la SAS ya va en la URL y no
  conviene que cualquier página pueda reutilizarla.
- Los métodos son `PUT`, **no** `POST`. El preflight usa `OPTIONS` y no hay que
  listarlo: Azure lo evalúa contra la regla.
- `x-ms-blob-type` es obligatorio o el `PUT` falla con 400 (`InvalidHeaderValue`).

O por consola:

```bash
az storage cors add --services b --methods PUT \
  --origins https://sigue-web.vercel.app \
  --allowed-headers x-ms-blob-type content-type \
  --exposed-headers etag x-ms-request-id \
  --max-age 3600 \
  --account-name siguefiles --auth-mode login
```

### 6. Variables en Render

En **Environment** del servicio `sigue-api`:

```dotenv
STORAGE_DRIVER=azure
AZURE_STORAGE_ACCOUNT_URL=https://siguefiles.blob.core.windows.net
AZURE_STORAGE_CONTAINER=sigue-files
AZURE_TENANT_ID=<tenant>
AZURE_CLIENT_ID=<appId>
AZURE_CLIENT_SECRET=<password>
MAX_DIRECT_UPLOAD_MB=250
```

Pon primero las credenciales y **después** `STORAGE_DRIVER=azure`: el arranque
valida que exista `AZURE_STORAGE_ACCOUNT_URL` y, si falta, el servicio no
levanta. Después **Manual Deploy → Deploy latest commit**. No hay migración de
esquema.

> Los cambios de `value:` en `render.yaml` no se aplican con un deploy normal:
> entran con un **Blueprint Sync**. Si prefieres tocar el panel de Render, hazlo
> ahí directamente para no pelearte con el siguiente sync.

### 7. Comprobar

```bash
# Debe responder {"direct":true,"maxMb":250,"proxyMaxMb":4}
curl -s https://sigue-api.onrender.com/api/v1/orgs/<org>/documents/upload-capabilities \
  -H "Authorization: Bearer <token>"
```

En la web, el pie del campo de archivo pasa a mostrar «(250 MB)». Sube un PDF de
más de 5 MB: ahora entra, y al redesplegar la API **sigue estando**.

Si falla, el error dice dónde:

| Síntoma | Causa |
|---|---|
| 403 antes de enviar el archivo, en la consola del navegador | Falta la regla CORS (paso 5) |
| 403 al pedir el ticket (`files/ticket`) | Rol mal asignado o aún sin propagar (paso 4) |
| `direct: false` en `upload-capabilities` | La API sigue con `STORAGE_DRIVER=local` |
| 502 al arrancar | Falta `AZURE_STORAGE_ACCOUNT_URL` o el contenedor no existe |

## Detalles de implementación

- `presignPut` usa **claves de delegación de usuario**, no la clave de la
  cuenta: el permiso lo emite la identidad de la aplicación y no hay secretos de
  larga vida para firmar.
- La URL concede solo `create` y `write` sobre **un** blob concreto, con
  caducidad de 15 minutos. No permite listar ni leer.
- La `key` la genera el servidor (`org-<orgId>/doc-<documentId>/<ts>-<archivo>`)
  y la confirmación exige ese prefijo: un cliente no puede registrar un archivo
  en la carpeta de otra organización.
- En la confirmación el tamaño se toma del propio almacén (`stat`), no de lo que
  declare el cliente, y se valida la cuota del plan antes de crear la fila.
- El `sha256` no se calcula en la subida directa (el binario no pasa por la API);
  la columna queda en `null` y la descarga solo valida si hay hash.

## Costos

Blob Storage con LRS cuesta del orden de **$0.02/GB-mes** más las operaciones.
Para el uso típico de un SGI (miles de documentos) es una fracción del plan de
Render de $7. No hay cargo por transferencia de subida.
