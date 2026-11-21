# syntax=docker/dockerfile:1
# Imagen del worker. Contexto de build: la raíz del repo.
#   docker build -f apps/worker/Dockerfile -t shiny-journey-worker .

FROM node:22-alpine AS build
WORKDIR /repo
COPY . .
# Solo las dependencias del worker (y de los paquetes del monorepo que usa).
RUN npm ci --workspace=@ravyn/worker --ignore-scripts --no-audit --no-fund
RUN npm run build -w @ravyn/worker

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
# El bundle de esbuild trae todas las dependencias: no hace falta node_modules.
COPY --from=build --chown=node:node /repo/apps/worker/dist/ ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["node", "--enable-source-maps", "main.mjs"]
