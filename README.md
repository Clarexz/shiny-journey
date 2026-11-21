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
