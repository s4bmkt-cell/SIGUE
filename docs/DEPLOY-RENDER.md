# Despliegue de la API en Render + PostgreSQL en Neon

La web ya vive en Vercel (`docs/DEPLOY-VERCEL.md`). Falta la API, y este es el
camino que no exige tarjeta ni cuenta de nube:

| Pieza | Dónde | Por qué ahí |
|---|---|---|
| Web Next.js | Vercel | Estático + proxy `/api/*` en funciones |
| API NestJS | Render (Docker) | Proceso de larga vida con conexión persistente a la base |
| PostgreSQL 16+ | Neon | Gratis, con `CREATEROLE` para crear el rol de aplicación |

`db:setup-role` hace `CREATE ROLE sigue_app`, le concede solo DML, habilita RLS en
las 76 tablas de inquilino y retira sus privilegios de DDL. Necesita un usuario
con `CREATEROLE`; el rol propietario de Neon lo tiene. `Organization` es la
excepción en los permisos: la app la lee y la edita, pero no la crea ni la borra
—eso lo hacen el seed y `db:provision` con el rol dueño.

> **Sobre `BYPASSRLS`:** el script intenta `ALTER ROLE … BYPASSRLS` para que el
> dueño quede exento de las políticas, y luego aplica `FORCE ROW LEVEL SECURITY`
> solo si lo consiguió. En Neon se cumple: `neondb_owner` ya viene con
> `rolbypassrls = true` (verificado, ver «Verificación hecha»), así que las tablas
> quedan forzadas. Lo que **no** es posible es que un rol *herede* el atributo por
> membresía: hay que tenerlo o hacer `SET ROLE`. Si el proveedor no lo concede, el
> script lo detecta y deja las tablas sin `FORCE`; el dueño puede migrar y
> sembrar, y el rol de aplicación sigue sujeto a RLS, que es lo que protege el
> aislamiento.

> **Railway no es opción ahora**: su registro de cuentas nuevas está pausado a
> nivel global («New account signups remain paused»), tanto con Google como con
> GitHub. No es un problema de tu cuenta.

---

## 1. Crear la base en Neon

1. Entra a <https://neon.tech> y crea un proyecto. Nombre sugerido: `sigue`.
2. **Región**: `AWS us-east-2 (Ohio)` — la misma que la API en Render, para que el
   salto de red sea mínimo.
3. Abre el panel **Connect** (botón *Connect* del proyecto) y **apaga el
   interruptor «Connection pooling»**. Es el único cambio que hay que hacer ahí:
   el host pasa de `ep-xxxx-pooler.c-6.us-east-2.aws.neon.tech` a
   `ep-xxxx.c-6.us-east-2.aws.neon.tech` (sin `-pooler`).
4. Deja **Database** = `neondb` y **Role** = `neondb_owner`, pulsa **Copy snippet**
   y guarda la cadena. Los asteriscos de la pantalla son un enmascarado visual: lo
   copiado lleva la contraseña real (compruébalo con **Show password** si dudas).

```dotenv
# Única cadena que necesitas ahora: rol propietario
postgresql://neondb_owner:<clave>@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require
```

> La guía habla de **dos** cadenas porque al final hay dos roles, pero la del rol
> de aplicación (`sigue_app`) no existe hasta el paso 3. No la busques ahora: se
> genera volviendo a este panel con **Role** = `sigue_app`.

¿Por qué directa y no la *pooled*? El contenedor es un proceso de larga vida, no
una función serverless. La conexión *pooled* de Neon funciona en modo
transacción, y Prisma necesita declarar `pgbouncer=true` y `connection_limit=1`
para convivir con ella. La directa evita esa clase de fallos sin costo.

Neon añade `channel_binding=require` al final de la cadena. Prisma 6 lo tolera,
así que no hace falta quitarlo.

La base por defecto se llama `neondb`; si creaste otra, ajusta `APP_DB_NAME`
en el paso 3.

## 2. Aplicar migraciones

Desde tu máquina, con la cadena del **propietario** en las dos variables (las dos
apuntan a la misma cadena; `DATABASE_URL` solo se usa aquí):

```bash
export DATABASE_URL="postgresql://neondb_owner:...@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
export DIRECT_URL="$DATABASE_URL"

npm ci
npm run db:generate
npm run db:deploy     # prisma migrate deploy: crea todas las tablas
```

`db:deploy` deja las tablas en manos del propietario pero **sin** el rol de
aplicación: la API todavía no puede arrancar contra ellas. Ese es el paso 3.

## 3. Crear el rol de aplicación y forzar RLS

```bash
export DATABASE_URL_ADMIN="$DIRECT_URL"
export APP_DB_PASSWORD="$(openssl rand -hex 24)"   # guárdala: va en DATABASE_URL
export APP_DB_NAME=neondb                          # nombre real de tu base
export APP_DB_OWNER=neondb_owner                   # el rol con el que conecta DIRECT_URL
npm run db:setup-role
```

Al terminar imprime `✔ Rol "sigue_app" aprovisionado. Tablas con RLS forzado: N`.
Es idempotente: puedes repetirlo tras un despliegue que añada tablas sin miedo.

> **Ojo con la conexión que usa este paso:** `db:setup-role` conecta con
> `DATABASE_URL_ADMIN`, no con `DATABASE_URL`. Si trabajas con un `.env` local que
> ya define `DATABASE_URL_ADMIN` apuntando a tu Postgres de desarrollo, el script
> actúa sobre local y el contador de Neon no cambia. Las variables exportadas en
> la misma línea de comandos ganan sobre el `.env`; comprueba el host antes de
> darlo por hecho.

Ahora sí toca la **segunda** cadena: vuelve al panel **Connect**, pon **Role** =
`sigue_app`, **Copy snippet** y guárdala. Es el `DATABASE_URL` de la API en Render
(paso 5) y lleva la contraseña de `APP_DB_PASSWORD`, la que acabas de generar.

Si tu proveedor **no** da `BYPASSRLS` al propietario, el script añade una segunda
línea avisando de que las tablas quedan sin `FORCE`. No es un error: el
aislamiento se apoya en el rol de aplicación, que no es propietario y sí queda
sujeto a las políticas. Con Neon no ocurre: el contador debe decir **76**.

Comprueba que el rol restringido **no** puede ver otras organizaciones ni hacer
DDL:

```bash
psql "$DATABASE_URL" -c 'CREATE TABLE prueba(x int);'
# ERROR: permission denied for schema public
```

## 4. Cargar el catálogo y crear la primera organización

Un solo comando hace las dos cosas, en el orden correcto (sin catálogo no hay
normas que activar; sin organización no hay a quién dar acceso):

```bash
export DIRECT_URL="postgresql://neondb_owner:...@ep-xxxx.us-east-2.aws.neon.tech/neondb?sslmode=require"
export ADMIN_PASSWORD="$(openssl rand -base64 24)"

npm run db:provision -- \
  --org-name "Nombre Legal, S.A. de C.V." \
  --admin-email "tu-correo@tu-dominio.mx" \
  --admin-name "Tu Nombre" \
  --plan BUSINESS \
  --standards ISO9001,ISO27001
```

Sin la organización el sistema queda inutilizable: `POST /auth/register` crea el
usuario **sin organización**, la pantalla de acceso no tiene alta salvo por
invitación y el token se emite con `orgId: null`, así que al entrar no hay nada
que ver.

> **Acentos en Windows:** si la consola no habla UTF-8, `--org-name` llega con
> `U+FFFD` *(el rombo )* en lugar de la letra. Desde commit `074bbd1` el script
> lo detecta y aborta sin escribir; la solución es `chcp 65001` antes de lanzar
> el comando, o pasar el nombre sin acentos. En Git Bash también conviene no usar
> `curl.exe` para mandar cuerpos con acentos: manda `U+FFFD` aunque la consola
> sea UTF-8.

Qué hace: carga el catálogo normativo, crea la organización, su `Subscription`
(obligatoria: sin ella la pantalla de facturación responde 404), el usuario
administrador, la membresía con `admin_org`, activa las normas indicadas con su
Declaración de Aplicabilidad si tienen Anexo A, y siembra las plantillas
propietarias.

Es idempotente: repetirlo **no** duplica nada y **no** cambia la contraseña del
usuario existente (para eso, `--reset-password`). La clave va en `ADMIN_PASSWORD`
y no como argumento, para no dejarla en el historial del shell.

| Argumento | Notas |
|---|---|
| `--org-name`, `--admin-email`, `--admin-name` | Obligatorios. |
| `--plan` | `ESSENTIAL` (1 norma), `PROFESSIONAL` (3), `BUSINESS` (6), `CONSULTANT` (6). Por defecto `ESSENTIAL`. |
| `--standards` | Códigos del catálogo, separados por comas. Avisa si exceden el plan. |
| `--roles` | Por defecto `admin_org`. Debe incluir `admin_org`. |
| `--org-id` | Fija un identificador estable; solo hace falta si hay nombres repetidos. |
| `--reset-password` | Restablece la clave de un usuario ya existente. |
| `--no-catalog` | Omite la carga del catálogo (no se puede combinar con `--standards`). |
| `--dry-run` | Valida y muestra lo que haría, sin escribir nada. |

## 5. Publicar la API en Render

El repositorio ya trae `render.yaml`, un *blueprint* que describe el servicio.

1. Entra a <https://dashboard.render.com> y autoriza tu cuenta de GitHub.
2. **New → Blueprint**, elige el repositorio `MiguelGGal/sigue`.
3. Render lee `render.yaml` y pide los valores marcados `sync: false`:
   - `DATABASE_URL` → cadena con el rol **`sigue_app`** (la del paso 3, con la
     contraseña que generaste).
   - `DIRECT_URL` → cadena con el rol **propietario**.

   Ambos son obligatorios: Prisma valida todas las variables del `datasource` al
   construir el cliente, aunque en tiempo de ejecución solo use `DATABASE_URL`.
4. **Apply**. El build compila con `apps/api/Dockerfile` y publica
   `https://sigue-api-xxxx.onrender.com`.

El blueprint fija `NODE_ENV=production`, `TRUST_PROXY=1`, y los orígenes
`https://sigue-web.vercel.app` en `CORS_ORIGINS` y `WEB_APP_URL`. Genera los dos
secretos JWT con `generateValue: true`.

> Si aplicaste el blueprint **antes** de tener las cadenas de Neon, cambia las
> variables en **Environment** y usa **Manual Deploy → Deploy latest commit**.

## 6. Comprobar la API

```bash
curl -s https://sigue-api-xxxx.onrender.com/api/v1/health
# {"status":"ok","service":"sigue-api","time":"..."}
```

Si responde `502` o el servicio no arranca, revisa **Logs**: la causa más común es
`Configuración de entorno inválida` (un secreto JWT de menos de 32 caracteres) o
un `DATABASE_URL` con el rol equivocado.

## 7. Conectar la web

En Vercel → **Settings → Environment Variables**, en *Production*, *Preview* y
*Development*:

```dotenv
API_INTERNAL_URL=https://sigue-api-xxxx.onrender.com
```

Después **Deployments → Redeploy** del último despliegue. El proxy lee la
variable en cada petición, pero el proceso en marcha no ve la nueva hasta que se
reconstruye.

Verificación de extremo a extremo:

```bash
curl -s https://sigue-web.vercel.app/api/v1/health
# {"status":"ok",...}  ← ya no es el 502 del proxy
```

Luego entra a `https://sigue-web.vercel.app/login` con el correo y la contraseña
del paso 4. Para poder usar el sistema hace falta una organización con su
administrador, y **el registro por sí solo no la crea**: la pantalla de acceso no
tiene formulario de alta y `POST /auth/register` deja la cuenta sin organización.
Hay dos caminos:

- **Producción:** `npm run db:provision` (paso 4) crea la primera organización con
  su administrador. A partir de ahí, los demás usuarios entran por invitación a
  una organización existente; la invitación se acepta en `/accept-invitation` y
  al aceptarla la cuenta queda vinculada con su rol.
- **Demostración rápida:** `npm run db:seed` en lugar de `db:provision`. Crea las
  organizaciones `org-ejemplo` y `org-demo` con usuarios listos (ver README). Solo
  para pruebas: no lo ejecutes con datos reales, porque reinicia los datos
  operativos de esas dos organizaciones y usa la contraseña pública
  `demo-password`.

> La pantalla de acceso no ofrece «crear cuenta»: el único alta es por invitación
> (`/accept-invitation`) o por API. Esto es coherente con un sistema
> multiorganización, pero significa que en un despliegue nuevo hay que crear la
> primera organización antes de poder entrar.

---

## Límites del plan gratuito y cuándo pagar

| Límite de Render Free | Efecto | Cuándo duele |
|---|---|---|
| Suspensión tras 15 min sin tráfico | ~1 min de arranque en frío | Demos y primeras pruebas; no en uso diario |
| 750 h/mes de instancia | Suficiente para un servicio | Segundo servicio en el mismo workspace |
| Disco efímero | Las evidencias subidas se pierden en cada despliegue | En cuanto se suban archivos reales |
| Sin `preDeployCommand` | Las migraciones se lanzan a mano desde local | Cada migración nueva |
| Sin respaldos de Neon en Free | Solo 1 GB y sin PITR | Antes de datos de clientes |

El primer paso de pago sensato es la instancia de **$7/mes** (`0.5c-512mb`):
habilita `preDeployCommand` y disco persistente, y quita la suspensión. Para
evidencias serias, en cambio, conviene `STORAGE_DRIVER=azure` con Blob Storage
(`docs/DEPLOY-AZURE.md`): así el disco deja de importar y el servicio puede
escalar a más de una instancia.

Si el plan Free no acepta `runtime: docker` en tu cuenta, cambia la línea `plan:`
de `render.yaml` a `0.5c-512mb`; es el único ajuste necesario.

## Verificación hecha

Los caminos del script se probaron en local sobre PostgreSQL 18 con el rol de
aplicación real:

| Escenario | Dueño | Resultado |
|---|---|---|
| Base autogestionada (CI, desarrollo) | superusuario → recibe `BYPASSRLS` | `✔ … Tablas con RLS forzado: 76` |
| Base gestionada con dueño sin `BYPASSRLS` | sin superusuario, sin el atributo | `✔ … Tablas con RLS forzado: 0` + aviso |
| Neon real (`neondb_owner`) | `rolbypassrls = true` | `✔ … Tablas con RLS forzado: 76` |

El tercer caso se comprobó el 2026-10-25 contra el proyecto `sigue` en Neon:
`SELECT rolsuper, rolbypassrls, rolcreaterole` devuelve `false, true, true`, y una
tabla temporal con `FORCE ROW LEVEL SECURITY` y política `USING (false)` dejó ver
sus 2 filas, que es justo lo que solo puede pasar si el dueño está exento. La
prueba se hizo dentro de una transacción revertida: la base quedó sin tablas.

En los tres: `db:seed` completa, y las suites `tenant-isolation` y `audit` pasan
(25 pruebas). La primera confirma que el rol de aplicación no ve filas de otra
organización ni sin contexto; la segunda, que la bitácora es append-only incluso
para el dueño.

También verificado el 2026-10-25 en el mismo proyecto: `db:deploy` aplicó las 11
migraciones sobre PostgreSQL 18.6 en Neon sin errores, y con el rol de aplicación
real: sin `app.org_id` la tabla `Organization` devuelve 0 filas, con contexto
devuelve solo la propia, y `INSERT`/`DELETE` fallan con `42501 permission denied`.

Queda sin probar aquí lo que solo existe en el proveedor: el build de la imagen en
Render y el arranque real del contenedor contra Neon.

## Alternativa: todo en Azure

`iac/main.bicep` levanta la pila completa en Container Apps. Si eliges esa ruta,
ten en cuenta que el ingreso está definido como interno (`external: false`) para
que la web viviera en el mismo entorno; al publicar la web en Vercel hay que
cambiarlo a `external: true`. Ver `docs/DEPLOY-AZURE.md`.
