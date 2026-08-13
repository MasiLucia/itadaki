#!/usr/bin/env bash
#
# Restores a dump over the current database.
#
# Destructive by definition: it drops what is there and puts the dump in its
# place. Asks before doing it, unless FORCE=1 — a restore is usually run at a
# bad moment, and typing the name of the file is the last chance to notice it
# is yesterday's rather than today's.
#
# Usage:
#   scripts/restore.sh backups/itadaki-20260813-030000.dump
#   FORCE=1 scripts/restore.sh <archivo>     # sin preguntar (para pruebas)

set -euo pipefail

CONTAINER="${DB_CONTAINER:-itadaki-db}"
DB_NAME="${POSTGRES_DB:-itadaki}"
DB_USER="${POSTGRES_USER:-itadaki}"

dump="${1:-}"
if [ -z "$dump" ]; then
  echo "uso: scripts/restore.sh <archivo.dump>" >&2
  echo "" >&2
  echo "respaldos disponibles:" >&2
  ls -1t ./backups/*.dump 2>/dev/null | head -10 >&2 || echo "  (ninguno)" >&2
  exit 1
fi

if [ ! -f "$dump" ]; then
  echo "error: no existe $dump" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "error: el contenedor $CONTAINER no está corriendo" >&2
  exit 1
fi

echo "Vas a reemplazar TODO el contenido de '$DB_NAME' con:"
echo "  $dump"
echo "  ($(date -r "$dump" '+%d/%m/%Y %H:%M' 2>/dev/null || echo 'fecha desconocida'))"
echo ""

if [ "${FORCE:-0}" != "1" ]; then
  printf "Escribí 'restaurar' para confirmar: "
  read -r answer
  if [ "$answer" != "restaurar" ]; then
    echo "cancelado"
    exit 1
  fi
fi

echo "restaurando…"
# --clean --if-exists drops each object before recreating it, so this works on
# a database that already has data. Ownership is not restored: the roles come
# from the migrations, not from whatever machine took the dump.
docker exec -i "$CONTAINER" pg_restore \
  -U "$DB_USER" -d "$DB_NAME" \
  --clean --if-exists --no-owner --no-privileges \
  < "$dump" 2>&1 | grep -v "^pg_restore: warning" || true

# The app role's grants live across the migrations, and --no-privileges
# dropped them. Every file has to run, not only the first: restaurant_tables
# is granted in 003, table_calls in 006. Missing one leaves the API able to
# read the menu and unable to open a table — which is exactly what a restore
# must not do. They are all idempotent.
echo "reaplicando permisos…"
for migration in libs/shared/persistence/src/lib/migrations/*.sql; do
  docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q \
    -v ON_ERROR_STOP=1 < "$migration" \
    || { echo "error al reaplicar $migration" >&2; exit 1; }
done

echo "listo"
