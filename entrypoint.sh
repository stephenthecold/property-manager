#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Root phase: the container STARTS as root only so it can repair ownership of
# pre-existing volumes (older releases ran the app as root, so the uploads
# volume is root-owned), then immediately drops to the unprivileged node user
# via setpriv and re-executes this script. Same pattern as the official
# postgres/redis images. If the container is started as a non-root user
# directly, the repair step is skipped and we fall through to the app phase.
# ---------------------------------------------------------------------------
if [ "$(id -u)" = "0" ]; then
  if [ "${STORAGE_PROVIDER:-stub}" = "local" ]; then
    # Same default as lib/config/env.ts (relative to /app).
    STORAGE_DIR="${LOCAL_STORAGE_DIR:-.data/uploads}"
    mkdir -p "$STORAGE_DIR" || {
      echo "[entrypoint] FATAL: cannot create LOCAL_STORAGE_DIR: $STORAGE_DIR"
      exit 1
    }
    # Self-heal a root-owned volume from a pre-non-root install. chown can
    # legitimately fail on network mounts (CIFS/NFS map ownership server-side)
    # — that's fine, the write test below is the real gate.
    if [ "$(stat -c %u "$STORAGE_DIR")" != "1000" ]; then
      echo "[entrypoint] fixing uploads ownership (one-time after upgrade)..."
      chown -R node:node "$STORAGE_DIR" 2>/dev/null || true
    fi
  fi
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi

# ---------------------------------------------------------------------------
# App phase (runs as node).
# ---------------------------------------------------------------------------

# Storage preflight: fail LOUDLY at startup instead of at upload time.
if [ "${STORAGE_PROVIDER:-stub}" = "local" ]; then
  STORAGE_DIR="${LOCAL_STORAGE_DIR:-.data/uploads}"
  mkdir -p "$STORAGE_DIR" 2>/dev/null || true
  if ! touch "$STORAGE_DIR/.write-test" 2>/dev/null; then
    echo "[entrypoint] FATAL: LOCAL_STORAGE_DIR is not writable by the app user (uid 1000): $STORAGE_DIR"
    echo "[entrypoint] - Named volume: remove any 'user:' override, or run once as root so ownership can be repaired."
    echo "[entrypoint] - CIFS/NFS bind mount: mount with ownership mapped to the app user, e.g. in /etc/fstab:"
    echo "[entrypoint]     uid=1000,gid=1000,file_mode=0660,dir_mode=0770"
    echo "[entrypoint] - Check that the mount exists on the host and the path in docker-compose matches LOCAL_STORAGE_DIR."
    exit 1
  fi
  rm -f "$STORAGE_DIR/.write-test"
  echo "[entrypoint] storage preflight OK: $STORAGE_DIR is writable"
fi

# Wait for the database to accept connections.
echo "[entrypoint] waiting for database..."
node -e "
const { Client } = require('pg');
(async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const c = new Client({ connectionString: process.env.DATABASE_URL });
      await c.connect();
      await c.end();
      process.exit(0);
    } catch {
      console.log('[entrypoint] db not ready, retrying...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error('[entrypoint] database not reachable');
  process.exit(1);
})();
"

# Only the app service applies migrations (RUN_MIGRATIONS=1).
if [ "$RUN_MIGRATIONS" = "1" ]; then
  echo "[entrypoint] applying migrations..."
  npx prisma migrate deploy
  if [ "$SEED_ON_START" = "true" ] || [ "$SEED_ON_START" = "1" ]; then
    echo "[entrypoint] seeding..."
    npm run db:seed || echo "[entrypoint] seed failed (continuing)"
  fi
fi

exec "$@"
