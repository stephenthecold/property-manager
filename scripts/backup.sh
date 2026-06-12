#!/usr/bin/env bash
set -euo pipefail

# Backs up the Postgres database (pg_dump | gzip) and the uploads files.
# Run from the repo root on the deploy host (cron-friendly). Configuration:
#   BACKUP_DIR        target directory (default ./backups)
#   RETENTION_DAYS    delete archives older than this; 0 disables (default 14)
#   UPLOADS_HOST_PATH set when uploads are bind-mounted (NAS layout); when
#                     unset, the `uploads` named volume is tarred via a
#                     throwaway container.
#
# NOTE: .env is intentionally NOT sourced wholesale (cron expressions in it
# break shell sourcing); only the needed keys are read.

# Archives contain financial data and the DB dump — owner-only from birth.
umask 077

# Read one key from .env (strips surrounding quotes only).
env_get() {
  grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true
}

BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TS="$(date +%Y%m%d-%H%M%S)"
PG_USER="${POSTGRES_USER:-$(env_get POSTGRES_USER)}"
PG_USER="${PG_USER:-pm}"
PG_DB="${POSTGRES_DB:-$(env_get POSTGRES_DB)}"
PG_DB="${PG_DB:-property_manager}"
UPLOADS_HOST_PATH="${UPLOADS_HOST_PATH:-$(env_get UPLOADS_HOST_PATH)}"

mkdir -p "$BACKUP_DIR"

echo "[backup] dumping database ($PG_DB)..."
# Unix-socket connections inside the official postgres image are trusted
# (initdb default pg_hba), so no password is normally needed; PGPASSWORD is
# passed anyway to also work under a hardened custom pg_hba.
PG_PASS="${POSTGRES_PASSWORD:-$(env_get POSTGRES_PASSWORD)}"
PG_ENV=()
[ -n "$PG_PASS" ] && PG_ENV=(-e "PGPASSWORD=$PG_PASS")
docker compose exec -T ${PG_ENV[@]+"${PG_ENV[@]}"} db pg_dump -U "$PG_USER" "$PG_DB" \
  | gzip > "$BACKUP_DIR/property-manager-db-$TS.sql.gz"

echo "[backup] archiving uploads..."
if [ -n "$UPLOADS_HOST_PATH" ]; then
  tar -czf "$BACKUP_DIR/property-manager-uploads-$TS.tar.gz" -C "$UPLOADS_HOST_PATH" .
else
  PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')}"
  docker run --rm -v "${PROJECT}_uploads:/from:ro" alpine \
    tar -cz -C /from . > "$BACKUP_DIR/property-manager-uploads-$TS.tar.gz"
fi

if [ "$RETENTION_DAYS" -gt 0 ]; then
  find "$BACKUP_DIR" -name 'property-manager-*.gz' -mtime +"$RETENTION_DAYS" -delete
fi

echo "[backup] done:"
ls -lh "$BACKUP_DIR" | tail -2
