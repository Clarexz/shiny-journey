# syntax=docker/dockerfile:1
# Imagen del panel web (Next.js standalone). Contexto de build: la raíz del repo.
#   docker build -f apps/web/Dockerfile -t shiny-journey-web .
# La configuración (Supabase, Redis, worker) se lee en tiempo de ejecución: la misma imagen
# sirve para cualquier entorno.

FROM node:22-alpine AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm ci --workspace=@ravyn/web --ignore-scripts --no-audit --no-fund
RUN npm run build -w @ravyn/web

FROM node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
