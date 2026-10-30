# Runbook operativo — SIGUE

Procedimientos para operar, desplegar y recuperar la plataforma. Todos los comandos se ejecutan
desde la raíz del monorepo (`sigue/`) salvo que se indique otra cosa.

---

## 1. Topología

| Componente | Puerto | Notas |
|---|---|---|
| Web (`@sigue/web`) | 3000 | Next.js. Proxy `/api/:path*` → API. |
| API (`@sigue/api`) | 3001 | NestJS. Prefijo `/api`, versionado por URI (`/api/v1/...`). |
| PostgreSQL | 5432 | Dos roles: dueño de tablas (`DIRECT_URL`) y aplicación con RLS (`DATABASE_URL`). |

**Salud**: `GET /api/v1/health` responde `200 {"status":"ok"}` sin autenticación.
**OpenAPI**: `GET /docs` (Swagger UI) y `GET /docs-json`. Las 229 operaciones llevan resumen,
etiqueta y respuestas `2xx`/`401`/`403`; la suite de integración falla si alguna se queda sin
documentar.

---

## 2. Roles de base de datos

| Rol | Variable | Usado por | Privilegios |
|---|---|---|---|
| Dueño (`sigue`) | `DIRECT_URL` | `db:migrate`, `db:deploy`, `db:seed`, reparación de auditoría | DDL y DML; con `BYPASSRLS` queda exento de las políticas. |
| Aplicación (`sigue_app`) | `DATABASE_URL` | API en ejecución | Solo DML sobre tablas de negocio; sin contexto de tenant no ve filas. Sobre `Organization` puede leer y editar, nunca crear ni borrar. |
| Administrador | `DATABASE_URL_ADMIN` | `npm run db:setup-role` | `CREATEROLE`; no lo usa la aplicación. |

`npm run db:setup-role` es idempotente: crea o actualiza `sigue_app`, concede DML, revoca lo
sobrante y activa RLS en las tablas de inquilino. **Hay que ejecutarlo después de cada migración
que añada tablas**, o la API recibirá `permission denied` al tocar la tabla nueva. Conecta con
`DATABASE_URL_ADMIN`: si tu `.env` la apunta a un Postgres local, el script actúa sobre ese y no
sobre el servidor que querías tocar.

Sobre `FORCE ROW LEVEL SECURITY`: el script intenta dar `BYPASSRLS` al dueño y, si lo consigue,
fuerza RLS también para él. En Neon lo consigue (`neondb_owner` ya trae `rolbypassrls = true`).
Si el proveedor no lo concede, deja las tablas **sin** `FORCE`: el dueño puede migrar y sembrar,
y `sigue_app` sigue sujeto a las políticas. Lo que nunca ocurre es la herencia por membresía: un
rol miembro de uno con `BYPASSRLS` **no** queda exento, hay que tener el atributo o hacer
`SET ROLE`. En ambos casos el aislamiento de la API es el mismo, porque se apoya en el rol de
aplicación.

Si aparece `permission denied for table <nueva>`, la causa es esa: vuelve a ejecutar
`npm run db:setup-role` y reinicia la API.

---

## 3. Despliegue

```bash
npm ci
npm run db:generate
npm run db:deploy        # migraciones pendientes con DIRECT_URL
npm run db:setup-role    # rol de aplicación al día
npm run db:catalog       # catálogo normativo (idempotente, sin datos demo)
npm run build
# arrancar API y web (PM2, systemd, contenedor...)
```

- **Nunca** ejecutes `db:deploy` con `DATABASE_URL` (rol de aplicación): no tiene DDL y fallará.
- El build de la web y `next dev` escriben en el mismo `.next`. En el servidor de producción no
  conviven; en local, detén el dev antes de compilar.
- `db:seed` es **solo para entornos de demostración**: reinicia los datos operativos de
  `org-ejemplo` y `org-demo`.
- `db:catalog` es la alternativa en producción: carga normas, cláusulas, proveedores de IA y
  plantillas propietarias sin crear usuarios ni organizaciones. Es idempotente y se puede
  ejecutar en cada despliegue.
- `db:provision` crea la **primera** organización con su administrador, plan y normas activadas
  (y, de paso, el catálogo). Hace falta en un despliegue nuevo: el registro de la web deja la
  cuenta sin organización y el token sale con `orgId` nulo. Ejemplo:

  ```bash
  export ADMIN_PASSWORD='<clave-fuerte>'
  npm run db:provision -- --org-name "Acme, S.A. de C.V." --admin-email admin@acme.mx \
    --admin-name "Ana Ruiz" --plan BUSINESS --standards ISO9001
  ```

  Es idempotente y no cambia la contraseña de un usuario existente salvo con `--reset-password`.
  Admite `--dry-run`. Detalle de argumentos en `docs/DEPLOY-RENDER.md` § 4.

### Variables obligatorias en producción

```dotenv
NODE_ENV=production
DATABASE_URL=postgresql://sigue_app:...@host:5432/sigue?schema=public&sslmode=require
DIRECT_URL=postgresql://sigue:...@host:5432/sigue?schema=public&sslmode=require
JWT_ACCESS_SECRET=<32+ caracteres aleatorios>
JWT_REFRESH_SECRET=<32+ caracteres aleatorios, distinto del anterior>
MFA_ENCRYPTION_KEY=<32+ caracteres aleatorios y estables>
CORS_ORIGINS=https://app.tudominio.mx
NEXT_PUBLIC_API_URL=https://api.tudominio.mx
```

Opcionales: `MAIL_FROM`, `POSTMARK_TOKEN`, `MAIL_OUTBOX_DIR`, `MAX_UPLOAD_MB`,
`MAX_DIRECT_UPLOAD_MB`, `STORAGE_DIR`, `AZURE_STORAGE_ACCOUNT_URL`,
`AZURE_STORAGE_CONTAINER`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`, `MFA_ISSUER`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `PAYMENTS_WEBHOOK_SECRET`.

> **Subidas grandes.** El proxy `/api/*` de la web corre como función en Vercel y
> corta el cuerpo en 4,5 MB. Para admitir archivos mayores hace falta
> `STORAGE_DRIVER=azure`: el navegador sube directo al Blob con una URL firmada.
> Ver [`UPLOADS-AZURE.md`](UPLOADS-AZURE.md).

La API **no arranca** si falta un secreto JWT o tiene menos de 32 caracteres
(`src/config/env.validation.ts`, fail-fast con Zod).

---

## 4. Sesión y autenticación

- Cookies `sigue_at` (access, 10 min) y `sigue_rt` (refresh, 7 días), `httpOnly`,
  `SameSite=Lax`, `Secure` cuando `NODE_ENV=production`.
- El frontend no guarda tokens en `localStorage`; el refresh es transparente ante un `401`.
- Login limitado a 5 intentos por minuto por IP **y por cuenta** (`AuthThrottlerGuard`): un
  usuario tras un NAT compartido no consume la cuota de sus compañeros, pero un ataque contra
  una sola cuenta sigue topado en 5 intentos por minuto.
- MFA TOTP: el desafío es un JWT firmado de 5 minutos, así que sobrevive a reinicios de la API.
- La semilla TOTP se guarda **cifrada** con AES-256-GCM (`MFA_ENCRYPTION_KEY`). Si no se define,
  se deriva de `JWT_ACCESS_SECRET`; en producción define una clave propia y estable.
  Cambiarla deja ilegibles las semillas y obliga a volver a registrar los autenticadores
  (los usuarios afectados no pueden completar el login hasta entonces).
- Activación: `GET /api/v1/auth/mfa/setup` (QR + clave, semilla pendiente con `mfaEnabled=false`)
  y `POST /api/v1/auth/mfa/setup` con un código de 6 dígitos. Desactivar exige un código vigente:
  `DELETE /api/v1/auth/mfa`.
- Para invalidar todas las sesiones de un usuario: `POST /api/v1/auth/logout-all`.

**Riesgo operativo**: rotar `JWT_ACCESS_SECRET` o `JWT_REFRESH_SECRET` invalida todas las sesiones
activas. Hazlo con la app drenada o avisa a los usuarios.

---

## 5. Auditoría e integridad

- Cada mutación relevante escribe en `AuditLog` con actor, IP, user-agent y payload, encadenado
  por SHA-256 **por organización**.
- Verificación: `GET /api/v1/orgs/:orgId/audit/integrity` (roles `admin_org`, `admin_global`,
  `auditor_interno`). Devuelve el número de eventos y el primer punto de ruptura si lo hay.
- Consulta paginada: `GET /api/v1/orgs/:orgId/audit?...`.

Si la verificación reporta una ruptura **legítima** (un bug de serialización previo), el script
`apps/api/prisma/audit-repair.mjs` recalcula solo los hashes cuya forma heredada coincide
exactamente; si un evento no coincide, aborta sin tocar nada. Úsalo con `--dry-run` primero:

```bash
cd apps/api
npm run build
node --env-file=.env prisma/audit-repair.mjs --dry-run
node --env-file=.env prisma/audit-repair.mjs
```

Si un evento **no** coincide con la forma heredada, es manipulación: no lo "arregles", restaura
desde respaldo e investiga.

---

## 6. Respaldos y restauración

```bash
# Respaldo lógico
pg_dump --format=custom --no-owner --file=sigue-$(date +%F).dump "$DIRECT_URL"

# Restauración en una base vacía
pg_restore --clean --if-exists --no-owner --dbname="$DIRECT_URL" sigue-2026-10-18.dump
npm run db:setup-role
```

- El respaldo debe hacerse con el rol **dueño** (`DIRECT_URL`): el rol de aplicación no ve todas
  las filas.
- Tras restaurar, vuelve a ejecutar `db:setup-role` (los privilegios del rol no viajan en el
  dump del esquema) y verifica la cadena de auditoría de cada organización.
- Archivos y correos locales viven en `apps/api/var/storage` y `apps/api/var/mail`; si usas el
  adaptador local en producción, inclúyelos en el respaldo.

---

## 7. Diagnóstico rápido

| Síntoma | Causa probable | Acción |
|---|---|---|
| Web en blanco o `Cargando…` tras un build | `next build` pisó `.next` del dev server | Detén el dev, `rm -rf apps/web/.next`, vuelve a arrancar |
| Vistas vacías y consola con `403` en `/members` | Organización activa sin acceso para el rol | Revisa el selector de organización; el rol debe tener membresía |
| `403` intermitente al cambiar de cliente | `localStorage` con `sigue.activeOrgId` obsoleto | Vuelve a elegir organización en la barra superior |
| `401` en todas las peticiones | Access token vencido y refresh inválido | Cierra sesión y entra de nuevo; revisa los secretos JWT |
| `permission denied for table …` | Rol de aplicación desactualizado | `npm run db:setup-role` |
| Datos visibles de otra organización | No debería ocurrir | `npm test --workspace @sigue/api -- tenant-isolation`; revisa `withTenant()` |
| `relation "…" does not exist` | Migraciones pendientes | `npm run db:deploy` |
| La API no arranca | Env inválido (Zod) | Lee el mensaje: nombra la variable y el problema |
| `Integridad rota` en auditoría | Bug previo o manipulación | `audit-repair.mjs --dry-run` y luego investiga |

Logs: la API escribe por `Logger` de Nest (stdout). En desarrollo, `npm run dev` mezcla los logs
de ambos paquetes; usa `npm run dev --workspace @sigue/api` para aislar la API.

---

## 8. CI

`.github/workflows/ci.yml` tiene tres jobs:

1. **lint-typecheck-test-build** — `npm ci`, lint, typecheck (incluido el de E2E), tests,
   `prisma validate` y `build`.
2. **database-tests** — PostgreSQL 16 real: migraciones, rol restringido, seed y suites de
   aislamiento RLS, cadena de auditoría e integración HTTP con Supertest.
3. **e2e** — PostgreSQL 16 + seed + Chromium: las 29 pruebas de Playwright. Publica
   `playwright-report/` y `test-results/` como artefacto si falla.

Para reproducir el job de E2E en local:

```bash
npx playwright install chromium
npm run test:e2e
```

---

## 9. Mantenimiento programado

| Frecuencia | Tarea |
|---|---|
| Diaria | Verificar `/api/v1/health` y el respaldo lógico |
| Semanal | Revisar logs de error y la integridad de auditoría de cada organización |
| Mensual | Actualizar dependencias menores; revisar cuotas y consumo por organización |
| Trimestral | Prueba de restauración completa en un entorno aislado y rotación de secretos |
