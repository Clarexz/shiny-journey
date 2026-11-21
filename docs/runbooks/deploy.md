# Runbook: primer despliegue y despliegues de rutina

Cubre T0.8 (primer despliegue en el VPS) y los despliegues posteriores. Lo ejecuta una persona
de Ravyn con acceso SSH al VPS.

## 1. Requisitos

- VPS con Docker y Docker Compose v2.20 o superior, y Traefik ya operando con el entrypoint
  `websecure`, el certresolver `le` y la red externa `traefik_public`.
- DNS: registro A de `app.ravyn-crm.cloud` (y `evo.ravyn-crm.cloud`) al VPS.
- Acceso de lectura a GHCR: un token de GitHub con `read:packages` (las imágenes de un repo
  privado son privadas).
- Checkout del repo en el VPS (por ejemplo `/opt/ravyn-agents`), solo para `infra/` y
  `supabase/migrations`.

## 2. Red y Supabase dedicado (una sola vez)

```bash
docker network create agents_net
```

1. Levantar una instancia **dedicada** de Supabase self-hosted (`supabase-agentes`) con el
   compose oficial de Supabase, en su propio directorio y con secretos nuevos (JWT secret,
   anon key, service role key, contraseña de Postgres). No compartirla con `ravyn-crm`.
2. Conectar Kong a `agents_net` con el alias `supabase-kong` (override del compose oficial):
   ```yaml
   services:
     kong:
       networks:
         default: {}
         agents_net: { aliases: [supabase-kong] }
   networks:
     agents_net: { external: true }
   ```
3. No publicar Kong ni Studio en Traefik (plan, 10.3). El puerto de Postgres solo en
   `127.0.0.1` del VPS.
4. En Auth: desactivar el registro público (`DISABLE_SIGNUP=true`); los usuarios los crea Ravyn.

## 3. Migraciones y verificación de RLS

Desde el VPS (o por túnel SSH al puerto de Postgres en `127.0.0.1`):

```bash
cd /opt/ravyn-agents
npx supabase db push --db-url "postgresql://postgres:<clave>@127.0.0.1:5432/postgres"
npm ci --workspace=@ravyn/db
npm run check-rls -- --db-url "postgresql://postgres:<clave>@127.0.0.1:5432/postgres"
```

`check-rls` debe imprimir que todas las tablas tienen RLS. La semilla `supabase/seed/dev.sql`
**no** se aplica en producción.

## 4. Archivos de entorno

```bash
cd /opt/ravyn-agents/infra
cp .env.example .env
for f in web worker evolution evolution-db; do cp env/$f.env.example env/$f.env; done
chmod 600 .env env/*.env
```

Completar los valores (las claves de Supabase son las de la instancia dedicada). El web no
lleva `ANTHROPIC_API_KEY` ni `EVOLUTION_API_KEY`.

## 5. Primer despliegue

```bash
echo "<token>" | docker login ghcr.io -u <usuario> --password-stdin
cd /opt/ravyn-agents
infra/scripts/deploy.sh <sha> --dry-run
docker compose -f infra/docker-compose.yml up -d redis evolution-db evolution
infra/scripts/deploy.sh <sha>
```

`<sha>` es el commit de `main` cuyo CI publicó las imágenes.

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
