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

# Storage preflight: fail LOUDLY at startup instead of at upload time. The
# test mirrors the real upload layout — a NESTED directory plus a file in it —
# because shares can allow top-level file writes while refusing directory
# creation (e.g. CIFS dir_mode without the execute bit, or file-only ACLs).
if [ "${STORAGE_PROVIDER:-stub}" = "local" ]; then
  STORAGE_DIR="${LOCAL_STORAGE_DIR:-.data/uploads}"
  mkdir -p "$STORAGE_DIR" 2>/dev/null || true
  if ! mkdir -p "$STORAGE_DIR/.preflight/nested" 2>/dev/null \
    || ! touch "$STORAGE_DIR/.preflight/nested/.write-test" 2>/dev/null; then
    echo "[entrypoint] FATAL: LOCAL_STORAGE_DIR does not allow nested directory+file writes by the app user (uid 1000): $STORAGE_DIR"
    echo "[entrypoint] - Named volume: remove any 'user:' override, or run once as root so ownership can be repaired."
    echo "[entrypoint] - CIFS/NFS bind mount: mount with ownership mapped to the app user AND directory create/traverse allowed,"
    echo "[entrypoint]   e.g. in /etc/fstab:  uid=1000,gid=1000,file_mode=0660,dir_mode=0770"
    echo "[entrypoint]   (dir_mode needs the execute bit — 0660 on directories breaks everything inside them; the share-side"
    echo "[entrypoint]   ACL must allow creating FOLDERS, not just files.)"
    echo "[entrypoint] - Check that the mount exists on the host and the path in docker-compose matches LOCAL_STORAGE_DIR."
    rm -rf "$STORAGE_DIR/.preflight" 2>/dev/null || true
    exit 1
  fi
  rm -rf "$STORAGE_DIR/.preflight"
  echo "[entrypoint] storage preflight OK: $STORAGE_DIR allows nested writes"
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
