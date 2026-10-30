# SIGUE — Plataforma SaaS de Sistemas de Gestión ISO

**SIGUE** digitaliza la implantación y el mantenimiento de sistemas de gestión ISO (ISO 9001, ISO/IEC 27001, ISO 22301, ISO/IEC 20000-1, ISO 37001 e ISO/IEC 42001) en una sola aplicación: diagnóstico, contexto, planificación de riesgos, información documentada, evidencias, auditorías internas, no conformidades, revisión por la dirección, tableros, seguridad de la información, continuidad del negocio, gestión de servicios de TI, gestión antisoborno y una capa transversal de IA gobernada.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 15 (App Router) · React 19 · TypeScript · Tailwind · TanStack Query v5 |
| Backend | NestJS 10 (monolito modular) · OpenAPI/Swagger |
| Base de datos | PostgreSQL 16+ · Prisma 6 · Row-Level Security (RLS) |
| Sesión | Cookies httpOnly (`sigue_at` / `sigue_rt`) · refresh rotation · MFA TOTP |
| Archivos | `StoragePort` con adaptador local en disco (Azure Blob tras el mismo puerto) |
| Correo | `MailerPort` con buzón local; Postmark se activa por variable de entorno |
| Pagos | `PaymentProviderPort` con adaptador local; Stripe se activa por variable de entorno |
| Pruebas | Jest (API) · Vitest (web) · Playwright (E2E) |
| CI | GitHub Actions (lint, typecheck, tests, build, RLS/auditoría y E2E) |

## Estructura del monorepo

```
sigue/
├── apps/
│   ├── api/                 # NestJS — API REST /api/v1
│   │   ├── prisma/          # esquema, migraciones, seed y catálogos ISO
│   │   └── src/
│   │       ├── common/      # guards, auditoría, mailer, storage, payments
│   │       ├── tenancy/     # membership guard, withTenant, RLS
│   │       └── modules/     # 24 módulos de dominio
│   └── web/                 # Next.js — SPA con proxy same-origin a la API
│       ├── app/             # / · /login · /reset-password · /accept-invitation
│       ├── components/      # layout, providers, ui y las 19 vistas
│       └── lib/             # cliente API, i18n, roles, hooks
├── e2e/                     # Playwright: setup de sesión + flujos críticos
├── packages/types/          # tipos compartidos
├── iac/                     # Bicep — infraestructura Azure (fase posterior)
└── docs/                    # guía de uso y material de referencia
```

## Estado

El producto está **funcionalmente completo** para las seis normas y todos los módulos del MVP:

- **Contenido normativo**: ISO 9001:2015 (32 requisitos), ISO/IEC 27001:2022 (118 requisitos + 93 controles del Anexo A), ISO 22301:2019 (26 requisitos), ISO/IEC 20000-1:2018 (44 requisitos), ISO 37001:2025 (34 requisitos) e ISO/IEC 42001:2023 (20 requisitos), con declaración de aplicabilidad (SOA) completa.
- **Seguridad**: RLS forzado con rol de aplicación restringido, auditoría inmutable con cadena de hashes por organización, cookies httpOnly, rotación de refresh tokens, MFA TOTP con QR (semilla cifrada en reposo y desactivación con código), rate limiting en login.
- **Dominio**: 229 operaciones REST repartidas en 27 etiquetas, todas con resumen y respuestas documentadas en OpenAPI, y con aislamiento por organización verificado por pruebas automatizadas.
- **Calidad**: `lint`, `typecheck`, 158 pruebas unitarias y de integración (156 API + 2 web) y
  29 pruebas E2E en verde; CI con job dedicado de base de datos real y otro de navegador.
- **Contrato**: pruebas de integración con Supertest sobre la aplicación completa
  (cookies httpOnly, rotación de refresh, 401/403 entre organizaciones) y verificación
  automática de que ninguna operación del OpenAPI queda sin documentar.

## Requisitos locales

- Node.js ≥ 20 (probado con 20 y 22)
- PostgreSQL ≥ 16 — 18 recomendado
- npm ≥ 10

## Puesta en marcha

### 1. Instalar dependencias

```bash
cd sigue
npm install
```

### 2. Configurar el entorno

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Edita `apps/api/.env` y ajusta al menos:

| Variable | Para qué sirve |
|---|---|
| `DATABASE_URL` | Rol **de aplicación** (`sigue_app`). Está sujeto a RLS: sin contexto de tenant no ve ninguna fila. |
| `DIRECT_URL` | Rol **dueño** de las tablas. Solo lo usan migraciones y seed. |
| `DATABASE_URL_ADMIN` | Rol con `CREATEROLE`, únicamente para `npm run db:setup-role`. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Secretos de firma. Mínimo 32 caracteres; distintos entre sí. |

`.env` está en `.gitignore`. **Nunca** lo commitees: contiene credenciales reales.

### 3. Preparar la base de datos

```bash
npm run db:generate      # cliente Prisma
npm run db:deploy        # aplica las migraciones con DIRECT_URL (rol dueño)
npm run db:setup-role    # crea sigue_app con privilegios mínimos y FORCE RLS
npm run db:catalog       # carga el catálogo normativo (6 normas) sin datos demo
npm run db:seed          # datos demo (idempotente)
```

### 4. Arrancar

```bash
npm run dev              # turbo: API en :3001 y web en :3000
```

- Aplicación: <http://localhost:3000>
- Health: <http://localhost:3001/api/v1/health>
- OpenAPI: <http://localhost:3001/docs>

> **No ejecutes `npm run build` mientras `npm run dev` está corriendo.** Ambos escriben en
> `apps/web/.next`; el build de producción lo reemplaza y el servidor de desarrollo empieza a
> servir HTML que referencia chunks inexistentes (la página queda en blanco o en `Cargando…`).
> Detén el servidor de desarrollo, ejecuta el build y vuelve a arrancar. Si ya ocurrió,
> `rm -rf apps/web/.next` y vuelve a levantar.

## Cuentas de demostración

| Correo | Contraseña | Roles en `Organización Ejemplo` | Para qué sirve |
|---|---|---|---|
| `mariana.torres@org.mx` | `demo-password` | `admin_org`, `resp_sgi` | Administra la organización; es el usuario de las pruebas E2E. |
| `jorge.aldana@org.mx` | `demo-password` | `admin_org` | Segundo administrador; sirve para probar que `admin_org` escribe en todo el SGI sin otros roles. |
| `consultora@demo.mx` | `demo-password` | `consultor_externo` | Consola multicliente (dos organizaciones asignadas). |

Mariana también pertenece a **Demo Consulting Group** (`org-demo`) con rol `colaborador`, lo que
permite comprobar el cambio de organización desde la barra superior y el aislamiento entre
inquilinos. La organización activa se guarda en `localStorage['sigue.activeOrgId']`.

### Quién puede escribir

`admin_org` administra la organización (miembros, invitaciones, plan) **y además opera el
contenido** de los módulos del SGI. No es un rol de solo administración: una organización recién
creada con `db:provision` tiene como único miembro al administrador, así que sin escritura quedaría
bloqueada hasta invitar a alguien más. `solo_lectura` es el único rol que no puede modificar nada.
La fuente de verdad son los `@RequireRoles` de cada controlador; la web replica la misma idea en
`WRITERS` (`apps/web/lib/hooks/use-permissions.ts`).

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | API + web en modo desarrollo |
| `npm run build` | Build de producción de ambos paquetes |
| `npm run lint` | ESLint (flat config) en API y web |
| `npm run typecheck` | `tsc --noEmit` en ambos paquetes |
| `npm run typecheck:e2e` | Typecheck de las pruebas Playwright |
| `npm test` | Jest (API) + Vitest (web) |
| `npm run test:e2e` | Playwright: levanta la pila si hace falta y ejecuta 29 pruebas |
| `npm run test:e2e:ui` | Playwright en modo interactivo |
| `npm run db:generate` | Genera el cliente Prisma |
| `npm run db:migrate` | Crea y aplica una migración (desarrollo) |
| `npm run db:deploy` | Aplica migraciones pendientes (CI/producción) |
| `npm run db:seed` | Siembra datos demo (idempotente) |
| `npm run db:catalog` | Carga/actualiza el catálogo normativo (ISO 9001, 27001, 22301, 20000-1, 37001 y 42001) |
| `npm run db:provision` | Crea una organización con su administrador, plan y normas (idempotente; ver `docs/DEPLOY-RENDER.md`) |
| `npm run db:setup-role` | Crea/actualiza el rol de aplicación y fuerza RLS |
| `npm run db:validate` | Valida el esquema Prisma |

## Pruebas

### Unitarias e integración

```bash
npm test                                             # todo
npm test --workspace @sigue/api -- tenant-isolation  # aislamiento RLS (requiere BD)
npm test --workspace @sigue/api -- audit             # cadena de auditoría
npm test --workspace @sigue/api -- integration       # HTTP real con Supertest (requiere BD)
```

Las suites que tocan PostgreSQL se omiten con un mensaje explícito si `TEST_DATABASE_URL` no
está definida; el resto corre sin base de datos.

`integration` levanta la aplicación completa (guards globales, validación de DTOs, cookies y
versionado) contra la base sembrada y habla con ella por HTTP: registro → login → perfil,
rotación y reutilización de refresh, 403 entre organizaciones y cobertura del OpenAPI.

### End-to-end (Playwright)

```bash
npx playwright install chromium   # una sola vez
npm run test:e2e
```

29 pruebas en tres proyectos:

| Proyecto | Pruebas | Cobertura |
|---|---|---|
| `setup` | 1 | Login real, cookies httpOnly y organización demo fijada |
| `anon` | 5 | Redirección al login, credenciales inválidas, recuperación neutra, login y logout, MFA de punta a punta |
| `chromium` | 23 | Contexto (portada, ocho accesos, contadores, SoA por norma, alcance, alta y baja de FODA y de factor PESTEL), ciclo de NC (alta y baja), ciclo documental completo, auditoría interna, barra lateral, tablero con las 6 normas, niveles editables, ISO 22301, ISO/IEC 20000-1, ISO 37001 y administración de organización |

Las pruebas comparten la organización demo, así que se ejecutan con `workers: 1` y sin
paralelismo. El `webServer` de Playwright arranca la API y la web con `next dev` (nunca
`next build`, que colisionaría con `.next`). Bajo `CI=true` no reutiliza servidores existentes.

## Arquitectura y decisiones clave

**Sesión en cookies httpOnly.** El frontend nunca toca los tokens: viaja por el proxy
`/api/:path*` de Next hacia la API, mismo origen. `sigue_at` (10 min por defecto) y `sigue_rt`
(7 días) son `httpOnly`, `SameSite=Lax` y `Secure` en producción. Ante un 401, el cliente
refresca una sola vez con un mutex, reintenta la petición original y, si el refresh falla,
cierra la sesión.

**Aislamiento multiempresa real.** `OrgMembershipGuard` valida la membresía sobre el `:orgId` de
la ruta. Cada operación abre una transacción y ejecuta
`set_config('app.org_id', <org>, true)` con un helper `withTenant()`. Las políticas RLS se
aplican porque la API conecta con `sigue_app`, un rol sin privilegios y con `FORCE ROW LEVEL
SECURITY`; migraciones y seed usan `DIRECT_URL` (rol dueño). `Organization` es la única tabla que
la app puede editar pero no crear ni borrar: el alta de organizaciones pasa por `db:provision`.

**Auditoría inmutable.** `AuditLog` guarda cada mutación con `entityId`, parámetros, IP y
user-agent, encadenada por hash (SHA-256) **por organización** con `pg_advisory_xact_lock` para
resolver la concurrencia. `GET /api/v1/orgs/:orgId/audit/integrity` recalcula la cadena y
reporta cualquier manipulación. La consulta de eventos está en
`GET /api/v1/orgs/:orgId/audit`, paginada y filtrable por actor, acción, entidad y fechas.

**Cumplimiento agregado por norma y cláusula.** Con seis normas activas, códigos como `4.1`
existen en ISO 9001, 27001, 22301, 20000-1 y 42001; la agregación (`dashboards/compliance.ts`, con pruebas
propias) agrupa por la pareja norma + cláusula y solo cuenta `IMPLEMENTED` y `MATURE`.

**Adaptadores tras puertos.** Correo, almacenamiento y pagos dependen de interfaces. Sin
credenciales externas el sistema funciona en modo local: el correo se escribe en `var/mail/`,
los archivos en `var/storage/` y los cambios de plan los aplica el servidor **sin cobrar nada**.
Postmark, Azure Blob y Stripe se activan con sus variables de entorno, sin tocar el dominio.

## Despliegue

La web está publicada en **<https://sigue-web.vercel.app>** (proyecto `sigue-web`,
raíz `apps/web`); cada push a `main` la redespliega. La API (NestJS + PostgreSQL)
va en un contenedor y se alcanza por el proxy same-origin de Next, que lee
`API_INTERNAL_URL` en tiempo de ejecución.

> Mientras no se configure `API_INTERNAL_URL` con una API real, la web carga pero
> `/api/*` responde `502 La API no está disponible` (lo emite el propio proxy).

El paso a paso de Vercel está en [`docs/DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md);
el de la API en Render con PostgreSQL en Neon, en
[`docs/DEPLOY-RENDER.md`](docs/DEPLOY-RENDER.md); el de la pila completa en
Container Apps, en [`docs/DEPLOY-AZURE.md`](docs/DEPLOY-AZURE.md). El runbook
operativo (respaldo, migraciones, rotación de secretos, diagnóstico de fallos)
está en [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

La API se despliega con el blueprint `render.yaml` de la raíz, que usa
`apps/api/Dockerfile`. Las migraciones **no** corren en el arranque: `db:deploy` y
`db:setup-role` se lanzan desde local con las credenciales del rol propietario.

Variables mínimas de la API en producción:

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://sigue_app:...@host:5432/sigue?schema=public&sslmode=require
DIRECT_URL=postgresql://dueno:...@host:5432/sigue?schema=public&sslmode=require
JWT_ACCESS_SECRET=<32+ caracteres aleatorios>
JWT_REFRESH_SECRET=<32+ caracteres aleatorios, distinto del anterior>
CORS_ORIGINS=https://app.tudominio.mx
TRUST_PROXY=1
```

Y en la web (Vercel):

```dotenv
API_INTERNAL_URL=https://api.tudominio.mx
```

Recuerda ejecutar `npm run db:deploy` y `npm run db:setup-role` contra la base nueva **antes**
de arrancar la API.

## Documentos de referencia

Están en el directorio padre del repositorio:

- `SIGUE-01-Fase-Descubrimiento.md` — producto, MVP, roles, historias y riesgos
- `SIGUE-02-Fase-UXUI.md` — diseño, sistema de diseño y wireframes
- `SIGUE-03-Fase-Arquitectura.md` — arquitectura, modelo de datos, RBAC, API y amenazas
- `docs/Guia_Uso_Rapida_SIGUE.pdf` — guía de uso para usuarios finales
