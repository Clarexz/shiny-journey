#!/usr/bin/env bash
# Verifica la persistencia mínima de Evolution (plan, 5.3 y 11.2; T1.5): las tablas de
# mensajes, chats y contactos de evolution-db deben estar vacías.
#
#   infra/scripts/verify-evolution-privacy.sh
#
# Solo cuenta filas: nunca imprime contenido. Sale con 0 si todas las tablas obligatorias
# están vacías, con 1 si alguna tiene filas y con 2 si no puede consultar la base.
#
# Nombres de tablas verificados en evoapicloud/evolution-api:v2.3.7 (esquema Prisma, tablas
# con comillas y mayúscula inicial). Si una versión nueva los cambia, el script falla con 2
# en lugar de reportar 0 en silencio: hay que actualizar las listas.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$INFRA_DIR/docker-compose.yml" --profile evolution)
DB_USER="${EVOLUTION_DB_USER:-evolution}"
DB_NAME="${EVOLUTION_DB_NAME:-evolution}"

# Deben quedar en 0 filas: mensajes, actualizaciones, chats, contactos, media e IsOnWhatsapp
# (caché de JIDs: con DATABASE_SAVE_IS_ON_WHATSAPP=true guarda los números de los contactos).
REQUIRED_EMPTY=(Message MessageUpdate Chat Contact Media IsOnWhatsapp)
# Solo informativas: metadatos que Evolution puede guardar aunque no persista mensajes.
INFORMATIVE=(Label)

psql_q() {
  "${COMPOSE[@]}" exec -T evolution-db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"
}

if ! psql_q "select 1" >/dev/null 2>&1; then
  echo "ERROR: no se pudo consultar evolution-db (¿está arriba el perfil evolution?)" >&2
  exit 2
fi

count_rows() {
  local table="$1" exists
  exists="$(psql_q "select to_regclass('public.\"$table\"') is not null")"
  if [[ "$exists" != "t" ]]; then
    echo "missing"
    return
  fi
  psql_q "select count(*) from public.\"$table\""
}

status=0
printf '%-16s %s\n' "tabla" "filas"
for table in "${REQUIRED_EMPTY[@]}"; do
  n="$(count_rows "$table")"
  if [[ "$n" == "missing" ]]; then
    printf '%-16s %s\n' "$table" "NO EXISTE (revisar esquema de esta versión)"
    [[ $status -eq 0 ]] && status=2
  elif [[ "$n" != "0" ]]; then
    printf '%-16s %s  <- FALLA\n' "$table" "$n"
    status=1
  else
    printf '%-16s %s\n' "$table" "$n"
  fi
done
for table in "${INFORMATIVE[@]}"; do
  n="$(count_rows "$table")"
  printf '%-16s %s  (informativa)\n' "$table" "$n"
done

case $status in
  0) echo "OK: Evolution no persiste mensajes, chats ni contactos." ;;
  1) echo "FALLA: hay filas en tablas que deben estar vacías (revisar DATABASE_SAVE_* en evolution.env)." >&2 ;;
  *) echo "ERROR: faltan tablas esperadas; actualizar el script para esta versión." >&2 ;;
esac
exit $status
