# Deployment

## Quick start (Docker Compose)

```bash
cp .env.example .env
npm install            # for the bootstrap/CLI tools (or run bootstrap in the container)
npm run bootstrap      # generates AUTH_SECRET, SETTINGS_ENC_KEY, SETUP_BOOTSTRAP_TOKEN into .env
# edit .env: set POSTGRES_PASSWORD, APP_URL, and (for prod) your domain

docker compose up -d            # app + db + worker (the lean stack)
```

On first start the **app** container waits for the DB, runs `prisma migrate deploy`, and
(if `SEED_ON_START=true`) seeds sample data, then serves on port 3000.

### First-run setup

1. Open `${APP_URL}/setup?token=${SETUP_BOOTSTRAP_TOKEN}` and create the first **owner**
   (use the email your Authentik account will have).
2. Provision an emergency login: `docker compose exec app npm run breakglass issue`
   (prints a one-time passphrase + auto-expiry). Sign in at `${APP_URL}/emergency`.
3. Configure OIDC under **Settings → Authentication** (see [AUTHENTIK.md](./AUTHENTIK.md)).
4. Sign out, sign in via Authentik. Break-glass auto-disables after the first OIDC owner login.

`/setup` is gated by **both** the bootstrap token **and** a zero-users check (with a DB advisory
lock against races), so it cannot be re-opened by wiping the users table.

## Compose profiles

| Profile | Adds | When |
|---|---|---|
| _(default)_ | app, db, worker | always |
| `idp` | Authentik (server, worker, its own Postgres, Redis) | bundled self-hosted SSO |
| `storage` | MinIO (S3-compatible) | Phase 2 uploads |
| `proxy` | Caddy (auto-HTTPS) | if you don't run your own proxy |

```bash
docker compose --profile idp --profile storage up -d
```

## TLS / reverse proxy (HTTPS-only)

The app listens on plain HTTP and expects a **trusted reverse proxy** to terminate TLS and set
`X-Forwarded-Proto=https`. Set `AUTH_TRUST_HOST=true`, `APP_URL=https://your-domain`, and
`TRUSTED_PROXY_COUNT` to the number of proxy hops. Two options:

- **Bring your own Caddy/Nginx/Traefik** (recommended). Forward `:443 → app:3000`. Example
  Caddy: `your-domain { reverse_proxy app:3000 }`.
- **Bundled Caddy**: `docker compose --profile proxy up -d` (set `APP_DOMAIN`). See
  [`Caddyfile`](../Caddyfile).

Session cookies are `HttpOnly`/`SameSite` and become `Secure` over HTTPS; do not run a real
deployment over plain HTTP.

## Secrets & key rotation

- `AUTH_SECRET`, `SETTINGS_ENC_KEY` and DB credentials live in `.env` (or Docker secrets / a
  secret manager). **Back up `SETTINGS_ENC_KEY`** — losing it makes the DB-stored OIDC client
  secret unrecoverable (env-fallback OIDC config still works).
- KEK rotation: re-encrypt the stored client secret under the new key (decrypt-with-old,
  encrypt-with-new); ciphertext is version-tagged (`oidcSecretKeyVersion`).

## Break-glass operations

```bash
docker compose exec app npm run breakglass issue [hours]   # provision (default 72h auto-expiry)
docker compose exec app npm run breakglass rotate          # new passphrase
docker compose exec app npm run breakglass disable         # turn off + clear credential
```

Break-glass is **off by default**, **owner-only**, argon2id-hashed, rate-limited, fully audited,
and **auto-expires**. A break-glass session is short-lived (30 min) and **cannot change auth
settings**. The `BREAK_GLASS=on` env override forces it on and bypasses auto-expiry — use only
during active recovery.

## Backups & migrations

- Back up the **app** Postgres volume (`db-data`) and, separately, the Authentik volume if
  bundled (`authentik-db`) — keep them decoupled.
- Migrations apply automatically on app start (`RUN_MIGRATIONS=1`, single replica). For
  scale-out, move migration to a one-shot job/release step.
- The `AuditLog` table is append-only at the DB level (a trigger blocks UPDATE/DELETE).

## Moving to another machine

Everything the app needs is the project directory + `.env` + (optionally) a database dump.
`node_modules/`, `.next/`, and `lib/generated/` are disposable — they're rebuilt by
`npm install` / the Docker build.

**On the old machine:**

```bash
# 1. Dump the database (skip if you're starting fresh on the new machine):
docker compose exec -T db pg_dump -U pm -d property_manager > backup.sql

# 2. Archive the project (keeps .env and .git; drops rebuildable dirs):
tar -czf property-manager.tar.gz \
  --exclude node_modules --exclude .next --exclude lib/generated \
  --exclude '*.tsbuildinfo' --exclude .DS_Store \
  -C "$(dirname "$PWD")" "$(basename "$PWD")"
```

> The archive contains `.env` — **AUTH_SECRET, SETTINGS_ENC_KEY, and the setup token**.
> Transfer it over a secure channel (scp/AirDrop/USB), not email or a public share.

**On the new machine** (needs Docker + Node 20+):

```bash
tar -xzf property-manager.tar.gz && cd "Property Manager"
npm install                       # CLI tooling (bootstrap/break-glass/dev)
docker compose up -d --build      # app + db + worker; migrations run automatically

# Fresh start: open  http://localhost:3000/setup?token=<SETUP_BOOTSTRAP_TOKEN from .env>
# Restoring data instead:
docker compose exec -T db psql -U pm -d property_manager < backup.sql
docker compose restart app worker

# Emergency login (passphrases don't survive a fresh DB — issue a new one):
docker compose exec app npm run breakglass issue
```

Keep the **same `SETTINGS_ENC_KEY`** when restoring a dump — the OIDC client secret stored in
the DB is encrypted under it. To continue development in Claude Code, just open the project
folder there; [`CLAUDE.md`](../CLAUDE.md) and [`docs/`](./) carry the working context.
