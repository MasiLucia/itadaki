#!/usr/bin/env bash
#
# Dumps the database to a timestamped file.
#
# Runs pg_dump inside the container so nothing has to be installed on the host,
# and uses the custom format (-Fc): compressed, and restorable table by table
# when only one thing was lost.
#
# Usage:
#   scripts/backup.sh                  # writes to ./backups
#   BACKUP_DIR=/mnt/disk scripts/backup.sh
#
# What this does NOT do: copy the file off this machine. A backup sitting on
# the same disk as the database is not a backup — see README for that step.

set -euo pipefail

CONTAINER="${DB_CONTAINER:-itadaki-db}"
DB_NAME="${POSTGRES_DB:-itadaki}"
DB_USER="${POSTGRES_USER:-itadaki}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$BACKUP_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
target="$BACKUP_DIR/itadaki-$stamp.dump"

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "error: el contenedor $CONTAINER no está corriendo" >&2
  exit 1
fi

echo "respaldando $DB_NAME…"
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$target"

# A dump that restores empty is worse than none, because it looks like safety.
size=$(wc -c < "$target" | tr -d ' ')
if [ "$size" -lt 1000 ]; then
  echo "error: el dump salió de $size bytes, algo falló" >&2
  rm -f "$target"
  exit 1
fi

echo "listo: $target ($(echo "$size" | awk '{printf "%.1f MB", $1/1048576}'))"

# Old dumps are deleted last, so a failure above never leaves us with nothing.
count=$(find "$BACKUP_DIR" -name 'itadaki-*.dump' | wc -l | tr -d ' ')
if [ "$count" -gt "$KEEP" ]; then
  find "$BACKUP_DIR" -name 'itadaki-*.dump' -print0 \
    | sort -z \
    | head -z -n "-$KEEP" \
    | xargs -0 rm -f
  echo "borrados $((count - KEEP)) respaldos viejos (se guardan $KEEP)"
fi
