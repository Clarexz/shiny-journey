# Plataforma de agentes de WhatsApp (Ravyn Studio)

Monorepo multi-tenant: un solo código y un solo despliegue donde Ravyn da de alta clientes,
conecta sus números de WhatsApp y activa módulos de agente configurables.

El plan completo está en [`docs/PLAN_IMPLEMENTACION.md`](docs/PLAN_IMPLEMENTACION.md).

## Requisitos

- Node 22 LTS (`.nvmrc`; Node 20 ya no tiene soporte) y npm 10 o superior.
- Docker (para Supabase local, Redis y el worker en desarrollo).
- Supabase CLI (`npx supabase ...`, no hace falta instalarlo globalmente).

## Estructura

```
apps/
  web/        Next.js 14 (panel del cliente, panel interno, PWA)
  worker/     Fastify + BullMQ (webhooks, API interna, colas)
packages/
  config/     tsconfig base, ESLint y Vitest compartidos
  core/       tipos de dominio, contexto de tenant, registro de módulos
  channels/   interfaz ChannelAdapter, normalización de teléfonos, registro, Fake y dry-run
  db/         cliente admin de Supabase, tipos generados, tenantTable(), check-rls
modules/      módulos de agente (fase 1: apartador-turnos, con el catálogo de sucursales y fixtures)
supabase/     config.toml, migraciones y semillas
infra/        docker-compose, ejemplos de env y scripts de despliegue
docs/         plan, anexos y runbooks
```

## Comandos

| Comando             | Qué hace                                         |
| ------------------- | ------------------------------------------------ |
| `npm ci`            | Instala las dependencias de todos los workspaces |
| `npm run lint`      | ESLint sobre todo el repo (cero advertencias)    |
| `npm run typecheck` | `tsc --noEmit` en cada workspace                 |
| `npm test`          | Vitest en todos los proyectos                    |
| `npm run format`    | Prettier                                         |

Los comandos de cada fase (Supabase, web, worker, despliegue) se documentan en su sección más abajo
a medida que se agregan.

## Base de datos (Supabase local)

```bash
npm run db:start    # levanta Supabase local en Docker (API 54321, Postgres 54322)
npm run db:reset    # aplica supabase/migrations y supabase/seed/*.sql desde cero
npm run db:types    # regenera packages/db/src/types.gen.ts
npm run check-rls   # falla si alguna tabla de public no tiene RLS
npm run gen:branches -w @ravyn/module-apartador-turnos  # regenera la migración del catálogo de sucursales
```

- Migraciones en `supabase/migrations/YYYYMMDDHHMM_nombre.sql`. Cada tabla nueva lleva
  `alter table ... enable row level security;` y ninguna política (ver plan, 11.1).
- Usuarios semilla (solo local): `owner@example.com` (tenant_owner de `dr-demo`) y
  `admin@example.com` (ravyn_admin), ambos con la contraseña `ravyn-dev-123`.

## Panel web (`apps/web`)

Next.js 16 (App Router), Tailwind 4 y shadcn/ui. Ver la decisión D-12 del plan sobre la versión.

```bash
cp apps/web/.env.example apps/web/.env.local   # completar con `npx supabase status`
npm run dev -w apps/web                        # http://localhost:3000
npm run build -w apps/web                      # build standalone (Docker)
```

- `proxy.ts` refresca la sesión en cada petición y manda a `/login` las páginas sin sesión.
  Las rutas `/api/*` no redirigen: responden 401.
- El login es una Server Action; el navegador no necesita claves de Supabase.

### Pruebas de integración

Las pruebas contra Supabase local se saltan si no hay credenciales. Para correrlas:

```bash
set -a && . apps/web/.env.local && set +a
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm test
```

## Worker (`apps/worker`)

Fastify (`/health`) y BullMQ con las colas `inbound`, `outbound`, `side-effects`, `notify` y
`maintenance` (sin procesadores en la fase 0). Logs JSON con pino, que redacta el contenido de
los mensajes (`text`, `message`, `body`, `pushName`, `participant`) y el token del webhook.

```bash
cp apps/worker/.env.example apps/worker/.env.local   # completar SUPABASE_SERVICE_ROLE_KEY
npm run dev -w apps/worker                           # requiere Redis en 127.0.0.1:6379
```

Con Docker (Redis y worker; Supabase sigue siendo el de `npm run db:start`):

```bash
export SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p')
docker compose -f infra/docker-compose.dev.yml up --build
curl localhost:3001/health   # {"ok":true,"redis":true,"db":true}
```

El build (`npm run build -w apps/worker`) genera un solo archivo `dist/main.mjs` con todas las
dependencias; la imagen final no lleva `node_modules`.

## Despliegue (`infra/`)

- `infra/docker-compose.yml`: web, worker, Redis, Evolution y su Postgres (plan, 10.2).
  Supabase va aparte con su compose oficial, en la red externa `agents_net`. Evolution está
  en el perfil `evolution` (fase 1). La red y el certresolver de Traefik se configuran con
  `TRAEFIK_NETWORK` y `TRAEFIK_CERTRESOLVER` en `infra/.env`.
- `infra/.env.example` y `infra/env/*.env.example`: copiar sin `.example` en el VPS, con
  `chmod 600`. Nunca se suben a git.
- `infra/scripts/deploy.sh <sha> [--dry-run]`: fija `APP_VERSION`, hace `pull`, `down`,
  `up -d` de web y worker y espera el healthcheck. Nunca usa `docker compose restart`.

```bash
infra/scripts/deploy.sh <sha> --dry-run
```

## CI (`.github/workflows/ci.yml`)

En cada PR y push a `main`: lint, formato, typecheck, Supabase local, `check-rls`, pruebas
(incluidas las de integración con Supabase y Redis), build de web y worker, validación de los
compose y de `deploy.sh`, y gitleaks sobre el historial. En `main` además construye y publica
`ghcr.io/clarexz/shiny-journey-{web,worker}:<sha>`.
