#!/usr/bin/env bash
# Despliega web y worker con la imagen del commit <sha> publicada en GHCR.
#
#   infra/scripts/deploy.sh <sha>             # despliega
#   infra/scripts/deploy.sh <sha> --dry-run   # muestra lo que haría, sin tocar nada
#   SKIP_PULL=1 infra/scripts/deploy.sh <sha> # usa imágenes ya presentes en el host
#
# Pasos: validar archivos y redes, fijar APP_VERSION en infra/.env, pull, down, up -d y
# esperar el healthcheck. Regla operativa: nunca `docker compose restart` (plan, 10.2).
# Solo toca web y worker: Redis y Evolution siguen arriba (reiniciar Evolution obliga a
# esperar la reconexión de WhatsApp).
set -euo pipefail

SERVICES=(web worker)
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-120}"
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$INFRA_DIR/.env"

usage() {
  echo "Uso: $0 <sha> [--dry-run]" >&2
  exit 2
}

SHA=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage ;;
    -*) echo "Opción desconocida: $arg" >&2; usage ;;
    *) [[ -z "$SHA" ]] && SHA="$arg" || usage ;;
  esac
done
[[ -n "$SHA" ]] || usage
if ! [[ "$SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "El sha debe ser hexadecimal en minúsculas (7 a 40 caracteres): $SHA" >&2
  exit 2
fi

log() { printf '[deploy] %s\n' "$*"; }
warn() { printf '[deploy] AVISO: %s\n' "$*" >&2; }
fail() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

# Ejecuta un comando, o solo lo muestra en modo --dry-run.
run() {
  printf '+ %s\n' "$*"
  if [[ "$DRY_RUN" -eq 0 ]]; then "$@"; fi
}

compose() { docker compose --project-directory "$INFRA_DIR" -f "$INFRA_DIR/docker-compose.yml" "$@"; }

# --- Comprobaciones previas -------------------------------------------------------------

missing=0
for f in "$ENV_FILE" "$INFRA_DIR"/env/{web,worker,evolution,evolution-db}.env; do
  if [[ ! -f "$f" ]]; then
    if [[ "$DRY_RUN" -eq 1 ]]; then warn "falta $f"; else fail "falta $f (ver ${f}.example)"; fi
    missing=1
    continue
  fi
  perms="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")"
  [[ "$perms" == "600" ]] || warn "$f tiene permisos $perms; deberían ser 600"
done

if command -v docker >/dev/null 2>&1; then
  for net in agents_net traefik_public; do
    if ! docker network inspect "$net" >/dev/null 2>&1; then
      if [[ "$DRY_RUN" -eq 1 ]]; then warn "no existe la red $net"; else fail "no existe la red $net"; fi
    fi
  done
elif [[ "$DRY_RUN" -eq 0 ]]; then
  fail "docker no está instalado"
fi

PREVIOUS=""
if [[ -f "$ENV_FILE" ]]; then
  PREVIOUS="$(sed -n 's/^APP_VERSION=//p' "$ENV_FILE" | tail -n1)"
fi
log "versión actual: ${PREVIOUS:-ninguna}; nueva: $SHA"

# --- Fijar APP_VERSION --------------------------------------------------------------------

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '+ fijar APP_VERSION=%s en %s\n' "$SHA" "$ENV_FILE"
else
  if grep -q '^APP_VERSION=' "$ENV_FILE"; then
    tmp="$(mktemp "$INFRA_DIR/.env.XXXXXX")"
    sed "s/^APP_VERSION=.*/APP_VERSION=$SHA/" "$ENV_FILE" >"$tmp"
    chmod 600 "$tmp"
    mv "$tmp" "$ENV_FILE"
  else
    printf 'APP_VERSION=%s\n' "$SHA" >>"$ENV_FILE"
  fi
fi

if [[ "$missing" -eq 0 ]]; then
  run compose config --quiet
fi

# --- Despliegue ---------------------------------------------------------------------------

if [[ "${SKIP_PULL:-0}" == "1" ]]; then
  log "SKIP_PULL=1: se usan las imágenes locales"
else
  run compose pull "${SERVICES[@]}"
fi
run compose down "${SERVICES[@]}"
run compose up -d "${SERVICES[@]}"

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '+ esperar healthcheck de %s (hasta %ss)\n' "${SERVICES[*]}" "$HEALTH_TIMEOUT_S"
  log "modo --dry-run: no se cambió nada"
  exit 0
fi

# --- Healthcheck --------------------------------------------------------------------------

deadline=$((SECONDS + HEALTH_TIMEOUT_S))
for svc in "${SERVICES[@]}"; do
  cid="$(compose ps -q "$svc")"
  [[ -n "$cid" ]] || fail "el servicio $svc no tiene contenedor"
  while :; do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-healthcheck{{end}}' "$cid")"
    case "$status" in
      healthy) log "$svc: healthy"; break ;;
      unhealthy | sin-healthcheck)
        compose logs --tail 50 "$svc" >&2 || true
        fail "$svc: $status. Para volver atrás: $0 ${PREVIOUS:-<sha-anterior>}"
        ;;
    esac
    if ((SECONDS >= deadline)); then
      compose logs --tail 50 "$svc" >&2 || true
      fail "$svc no quedó healthy en ${HEALTH_TIMEOUT_S}s. Para volver atrás: $0 ${PREVIOUS:-<sha-anterior>}"
    fi
    sleep 3
  done
done

log "desplegado $SHA (anterior: ${PREVIOUS:-ninguna})"
