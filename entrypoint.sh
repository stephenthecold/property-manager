#!/bin/sh
set -e

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
