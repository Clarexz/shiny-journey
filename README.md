# Plataforma de agentes de WhatsApp (Ravyn Studio)

Monorepo multi-tenant: un solo código y un solo despliegue donde Ravyn da de alta clientes,
conecta sus números de WhatsApp y activa módulos de agente configurables.

El plan completo está en [`docs/PLAN_IMPLEMENTACION.md`](docs/PLAN_IMPLEMENTACION.md).

## Requisitos

- Node 20 LTS o superior (`.nvmrc`) y npm 10.
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
  db/         cliente admin de Supabase, tipos generados, tenantTable(), check-rls
modules/      módulos de agente (fase 1: apartador-turnos)
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
