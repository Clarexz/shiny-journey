# Runbook: primer despliegue y despliegues de rutina

Cubre T0.8 (primer despliegue en el VPS) y los despliegues posteriores. Lo ejecuta una persona
de Ravyn con acceso SSH al VPS, o una sesión de Claude Code en el VPS con su supervisión.

Convención del VPS de Ravyn: los stacks viven en `/docker/<proyecto>` (Supabase) y
`/opt/<proyecto>` (apps); cada stack tiene su propio nombre de proyecto de compose y prefijo
de contenedores. Hay un único Traefik compartido (stack `/docker/n8n`): no se modifica.

## 1. Requisitos

- Docker y Docker Compose v2.20 o superior.
- Traefik operando con un entrypoint HTTPS `websecure`. Anotar el nombre de su **red externa**
  y de su **certresolver**: van en `infra/.env` como `TRAEFIK_NETWORK` y
  `TRAEFIK_CERTRESOLVER` (en el VPS de Ravyn: `n8n_default` y `mytlschallenge`).
- DNS: registro A de `app.ravyn-crm.cloud` a la IP del VPS. Sin esto, Let's Encrypt no emite
  el certificado. `evo.ravyn-crm.cloud` solo hace falta en la fase 1.
- Acceso de lectura a GHCR: un token de GitHub con `read:packages`.
- Node 22 para los comandos `npx`. Si el host no lo tiene, usar un contenedor:
  `docker run --rm -it --network host -v "$PWD:/w" -w /w node:22-alpine <comando>`.

## 2. Red y Supabase dedicado (una sola vez)

```bash
docker network create agents_net
```

1. Instancia **dedicada** de Supabase self-hosted en `/docker/supabase-agentes`, con nombre
   de proyecto `supabase-agentes`, el compose oficial y secretos nuevos (JWT secret, anon key,
   service role key, contraseña de Postgres). No se comparte con `ravyn-crm` ni con otros.
2. Un `docker-compose.override.yml` (mismo patrón que `/opt/app-parejas`) que:
   - renombra todos los `container_name` con prefijo `agentes-` (los oficiales chocan con las
     otras instancias);
   - conecta Kong a `agents_net` con el alias `supabase-kong`;
   - **quita los puertos publicados de Kong (8000, 8443) y de Supavisor (5432, 6543)**;
   - publica `db` solo en `127.0.0.1:5432` (para migraciones y `check-rls` desde el host).

   ```yaml
   services:
     kong:
       container_name: agentes-kong
       ports: !reset []
       networks:
         default: {}
         agents_net: { aliases: [supabase-kong] }
     supavisor:
       container_name: agentes-pooler
       ports: !reset []
     db:
       container_name: agentes-db
       ports: ["127.0.0.1:5432:5432"]
     # ... container_name agentes-* en el resto de servicios
   networks:
     agents_net: { external: true }
   ```
3. Ni Kong ni Studio se publican en Traefik (plan, 10.3).
4. En Auth: `DISABLE_SIGNUP=true`; los usuarios los crea Ravyn.
5. Opcional en la fase 0: apagar realtime, storage, functions y analytics si el compose
   oficial lo permite sin romper dependencias.

## 3. Migraciones y verificación de RLS

Con `db` publicado en `127.0.0.1:5432`, el usuario es `postgres` (sin sufijo de tenant, que
solo pide Supavisor):

```bash
cd /opt/ravyn-agents
DB_URL="postgresql://postgres:<clave>@127.0.0.1:5432/postgres"
npx supabase db push --db-url "$DB_URL"
npm ci --workspace=@ravyn/db
npm run check-rls -- --db-url "$DB_URL"
```

`check-rls` debe imprimir que todas las tablas tienen RLS. La semilla `supabase/seed/dev.sql`
**no** se aplica en producción.

## 4. Archivos de entorno

```bash
cd /opt/ravyn-agents/infra
cp .env.example .env
cp env/web.env.example env/web.env
cp env/worker.env.example env/worker.env
chmod 600 .env env/*.env
```

- `.env`: `TRAEFIK_NETWORK` y `TRAEFIK_CERTRESOLVER` del servidor. `APP_VERSION` lo fija
  `deploy.sh`. Las variables de Evolution se pueden dejar vacías en la fase 0: sin valor, el
  manager queda cerrado.
- `env/web.env` y `env/worker.env`: claves de la instancia dedicada; `WORKER_INTERNAL_TOKEN` y
  `ACTION_TOKEN_PEPPER` aleatorios e iguales en ambos. El web no lleva `ANTHROPIC_API_KEY` ni
  `EVOLUTION_API_KEY`.
- `env/evolution.env` y `env/evolution-db.env` se crean en la fase 1 (T1.5).

## 5. Primer despliegue

```bash
echo "<token>" | docker login ghcr.io -u <usuario> --password-stdin
cd /opt/ravyn-agents
infra/scripts/deploy.sh <sha> --dry-run
docker compose -f infra/docker-compose.yml up -d redis
infra/scripts/deploy.sh <sha>
```

`<sha>` es un commit de `main` cuyo CI publicó las imágenes. Evolution y su Postgres están en
el perfil `evolution` y no se levantan en la fase 0.

## 6. Verificación (criterio de aceptación de T0.8)

```bash
curl -sI https://app.ravyn-crm.cloud/login | head -1      # HTTP/2 200, TLS válido
docker compose -f infra/docker-compose.yml exec worker wget -qO- localhost:3001/health
# {"ok":true,"redis":true,"db":true}
```

Y `check-rls` contra producción (paso 3) sin tablas reportadas.

## 7. Primer usuario de Ravyn

Crear el usuario en Supabase Auth (Studio por túnel SSH, o la API admin con la service role)
y luego su perfil:

```sql
insert into public.users (id, tenant_id, full_name, role, email)
values ('<auth.users.id>', null, '<nombre>', 'ravyn_admin', '<correo>');
```

## 8. Despliegues de rutina y vuelta atrás

```bash
infra/scripts/deploy.sh <sha-nuevo>
```

Si el healthcheck falla, el script muestra los últimos logs y el comando para volver a la
versión anterior (`infra/scripts/deploy.sh <sha-anterior>`). Nunca usar
`docker compose restart`: siempre `down` y `up -d` (el script ya lo hace).

## 9. Fase 1: Evolution

```bash
cp infra/env/evolution.env.example infra/env/evolution.env
cp infra/env/evolution-db.env.example infra/env/evolution-db.env
chmod 600 infra/env/evolution*.env
# definir EVOLUTION_VERSION, EVO_BASIC_AUTH y EVO_IP_ALLOWLIST en infra/.env
docker compose -f infra/docker-compose.yml --profile evolution up -d evolution-db evolution
```
