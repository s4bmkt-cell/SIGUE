# Despliegue de la web en Vercel

Vercel publica **la web**. La API NestJS y PostgreSQL no caben ahí: la API abre
conexiones largas a la base, cada petición usa una transacción con
`set_config('app.org_id', …, true)` para que RLS aplique, guarda evidencias en
disco y ejecuta trabajos que no son una función serverless. Publicar solo la web
en Vercel y dejar la API en un contenedor es la división que ya asume el código:

```
navegador ──▶ web (Vercel)  ──/api/*──▶  API (contenedor)  ──▶  PostgreSQL
              Next.js 15                NestJS 10
              app/api/[...path]         valida sesión, RLS
```

El proxy `apps/web/app/api/[...path]/route.ts` resuelve la API **en tiempo de
ejecución** con `API_INTERNAL_URL`, así que la web se ve como un solo origen y
las cookies `httpOnly` + `SameSite=Lax` siguen funcionando sin CORS.

---

## 1. Requisitos

1. La API ya desplegada en una URL HTTPS pública (ver
   [`DEPLOY-AZURE.md`](DEPLOY-AZURE.md) para Container Apps, o cualquier host de
   contenedores con PostgreSQL 16).
2. El repositorio en GitHub.
3. Cuenta de Vercel con acceso a ese repositorio.

> Sin una API accesible, Vercel publica igualmente la web: el login carga, pero
> cualquier llamada devuelve `502 La API no está disponible`. Ese texto viene del
> propio proxy, no es un fallo del despliegue.
>
> **Estado actual:** la web está publicada en
> <https://sigue-web.vercel.app> y el despliegue automático desde GitHub
> funciona en cada push a `main`. Falta el punto 3 (`API_INTERNAL_URL`) para que
> el proxy deje de responder 502; la API se despliega en Render siguiendo
> [`DEPLOY-RENDER.md`](DEPLOY-RENDER.md).

## 2. Importar el proyecto

1. Vercel → **Add New… → Project** → importa el repositorio.
2. En **Root Directory** elige **`apps/web`**. Es obligatorio: en la raíz del
   monorepo no hay una app Next.js que detectar.
3. Deja **Framework Preset** en *Next.js* y no toques *Build Command*: Vercel
   ejecuta el `build` del `package.json` del workspace
   (`npm run build -w @sigue/web`). El `npm ci` lo corre en la raíz del
   repositorio, que es donde está el `package-lock.json` del workspace.

No hace falta `vercel.json`: el build estándar de Next.js es el que usa la
plataforma. `next.config.mjs` detecta `VERCEL` y omite `output: 'standalone'`
—ese directorio solo sirve para la imagen Docker—, y conserva
`outputFileTracingRoot` para que el rastreo de dependencias parta de la raíz del
monorepo.

> **Autoría de los commits.** Vercel bloquea el despliegue si el autor del commit
> no tiene cuenta en GitHub («Vercel couldn't find a Git account for the commit
> author»). Los commits de este repositorio se firman con
> `MiguelGGal <300625108+MiguelGGal@users.noreply.github.com>`, que es el correo
> noreply de la cuenta propietaria. Si cambias de máquina, configura ese
> `user.email` antes de commitear.

## 3. Variables de entorno

En **Settings → Environment Variables**, para *Production*, *Preview* y
*Development*:

| Variable | Valor | Para qué |
|---|---|---|
| `API_INTERNAL_URL` | `https://api.tudominio.mx` | Destino del proxy `/api/*`. Se lee en cada petición: cambiarla no exige reconstruir. |
| `NEXT_PUBLIC_API_URL` | *(opcional)* mismo valor | Respaldo histórico del proxy; úsala solo si prefieres no definir la anterior. |

No pongas secretos aquí: la web no firma nada. Los JWT, la cadena de conexión y
las claves de MFA viven solo en la API.

Cuando cambies estas variables, **redespliega** (`vercel --prod` o *Redeploy*):
las variables nuevas no se aplican a un despliegue ya construido.

## 4. Ajustar la API al nuevo origen

En el entorno de la API:

```dotenv
CORS_ORIGINS=https://tu-proyecto.vercel.app
NEXT_PUBLIC_API_URL=https://tu-proyecto.vercel.app
WEB_APP_URL=https://tu-proyecto.vercel.app
```

- `CORS_ORIGINS` es el primer origen de la lista el que se usa para armar los
  enlaces de correo (invitaciones y recuperación de contraseña), así que debe ser
  la URL pública de la web.
- Reinicia la API después de cambiarlas.
- Las cookies se marcan `Secure` cuando `NODE_ENV=production`, así que la web
  **debe** servirse por HTTPS. Vercel lo hace en todas sus URLs.

Cuando añadas un dominio propio, agrégalo también a `CORS_ORIGINS` (se admite una
lista separada por comas) para que las peticiones desde el dominio nuevo no se
rechacen.

## 5. Comprobar el despliegue

```bash
curl -s https://sigue-web.vercel.app/login            # 200 y el HTML del login
curl -s https://sigue-web.vercel.app/api/v1/health    # {"status":"ok",…}
```

1. Abre la URL de Vercel: debe aparecer la pantalla de acceso.
2. Entra con una cuenta real de la API desplegada.
3. Verifica que el proxy responde:
   `https://tu-proyecto.vercel.app/api/v1/health` → `{"status":"ok",…}`.

Si el health de la API responde directo pero la web devuelve 502, revisa
`API_INTERNAL_URL` y que la API acepte el origen de Vercel.

## 6. Qué no cabe en Vercel

| Necesidad | Por qué falla en Vercel | Alternativa |
|---|---|---|
| API NestJS | Conexión persistente a PostgreSQL y transacciones por petición; migraciones y `db:setup-role` son procesos de larga duración | Contenedor (Render, Container Apps, Fly) |
| Almacenamiento de evidencias | El disco de una función es efímero | `STORAGE_DRIVER=azure` (Blob) o un disco persistente del host |
| Buzón y webhooks de pago | El adaptador local escribe en `var/` | Postmark y Stripe por variables de entorno |
| Migraciones | Deben correr una sola vez, no por petición | Job o paso de despliegue aparte |

## 7. Vistas previas

Cada *pull request* genera un despliegue de vista previa con su propio dominio.
Si quieres que las vistas previas apunten a una API de pruebas, define
`API_INTERNAL_URL` solo en el entorno *Preview*; las cookies `Secure` siguen
siendo válidas porque Vercel sirve las vistas previas por HTTPS.
