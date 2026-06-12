# Deployment

## Quick start (Docker Compose)

```bash
git clone https://github.com/stephenthecold/property-manager.git && cd property-manager
./scripts/bootstrap.sh # creates .env + generates AUTH_SECRET, SETTINGS_ENC_KEY, SETUP_BOOTSTRAP_TOKEN
# edit .env: set POSTGRES_PASSWORD, APP_URL, and (for prod) your domain

docker compose up -d            # app + db + worker (the lean stack)
```

The host needs only git, Docker, and openssl — **no Node**: the app runs inside the image, and
break-glass/seed commands run via `docker compose exec app …`. (`npm run bootstrap` is the
equivalent for dev machines, which need Node 20.19+.)

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

## Updating

Two modes; both apply migrations automatically on app start:

- **Build from source** (default): `git pull && docker compose up -d --build`.
- **Pulled image**: CI ([`docker-publish.yml`](../.github/workflows/docker-publish.yml)) pushes
  the image to GHCR on every push to main (`:latest`, `:sha-<commit>`) and on `v*` tags. Set
  `APP_IMAGE=ghcr.io/<owner>/property-manager:sha-<commit>` in `.env`, then
  `docker compose pull app worker && docker compose up -d`. The deploy host needs no Node and
  never compiles anything. **Pin a `:sha-`/version tag, not `:latest`**: a pinned tag makes
  rollouts deliberate, rollbacks trivial, and prevents the failure mode where a newer compose
  file meets an older `:latest` image that was pulled weeks ago. If the GHCR package is
  private, `docker login ghcr.io` with a read-only PAT first.

### Upgrading across the non-root change

The app and worker now run as the unprivileged `node` user (uid/gid 1000) instead of root.
Existing installations almost always upgrade cleanly because the entrypoint briefly starts as
root, repairs the ownership of an uploads volume created by an older (root-running) release,
and only then drops privileges. Two cases need attention:

- **CIFS/SMB or NFS bind mounts** for uploads must map ownership to uid/gid 1000 — for CIFS
  add `uid=1000,gid=1000,file_mode=0660,dir_mode=0770` to the mount options in `/etc/fstab`,
  then `mount -o remount` (or unmount/mount) the share. The container now **refuses to start**
  with a clear message if the storage directory is not writable by the app user, instead of
  failing at upload time.
- **A `user:` override in a custom compose file** would skip the self-heal step; remove it (the
  entrypoint drops privileges itself) or chown the volume manually once:
  `docker run --rm -v <project>_uploads:/u alpine chown -R 1000:1000 /u`.

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
`X-Forwarded-Proto=https`. Set `APP_URL=https://your-domain` in `.env` (`AUTH_TRUST_HOST=true`
and `TRUSTED_PROXY_COUNT=1` are already the compose defaults). Three options:

- **Your own Caddy container** (recommended). Attach the app to the proxy's Docker network via
  the shipped override — in `.env`:

  ```bash
  COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
  CADDY_NETWORK=caddy        # the network your Caddy container is on (docker network ls)
  APP_URL=https://pm.example.com
  APP_BIND=127.0.0.1         # optional: stop exposing plain :3000 on the LAN
  ```

  then `docker compose up -d` (recreates the app attached to that network), add a site block
  to your Caddyfile — `pm.example.com { reverse_proxy property-manager:3000 }` — and reload
  Caddy. The override publishes the app on that network under the alias `property-manager`
  (not `app`, which would collide with other stacks behind the same proxy).
- **Host-level proxy** (Caddy/Nginx running on the host, not in Docker): proxy to
  `127.0.0.1:3000` and set `APP_BIND=127.0.0.1`.
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
- **`docker compose config` output is sensitive.** It interpolates and prints every secret
  (`DATABASE_URL` embeds the DB password; `AUTH_SECRET` etc. are resolved). Never paste it
  into issues, chats, or anything indexed.

### Rotation runbook (after a suspected exposure)

None of these steps touch your data — the database volume and uploaded files are unaffected.
Take a backup first anyway (`scripts/backup.sh`), then rotate in this order:

1. **DB password** (no data impact): `docker compose exec db psql -U pm -d property_manager -c
   "ALTER USER pm WITH PASSWORD '<new>';"` then update `POSTGRES_PASSWORD` in `.env` and
   `docker compose up -d` (recreates app/worker with the new URL).
2. **`SETUP_BOOTSTRAP_TOKEN`** (no impact unless mid-setup): generate a new value
   (`openssl rand -hex 32`), update `.env`, `docker compose up -d`.
3. **`AUTH_SECRET`** (signs session JWTs): new value via `openssl rand -base64 32`, update
   `.env`, restart. Everyone is signed out once and logs back in; nothing else changes.
4. **`SETTINGS_ENC_KEY`** (encrypts DB-stored provider secrets): rotating it makes the stored
   OIDC client secret, Twilio/Telnyx token, and SMTP/OAuth email secrets undecryptable — the
   app keeps running, but those integrations fail until you re-enter each secret in
   Settings → Auth / Messaging. Plan a few minutes of messaging downtime: set the new key,
   restart, then re-paste the provider secrets from their dashboards. Business data, users,
   leases, payments, and uploads are untouched.
5. **`STORAGE_ENC_KEY`** (if set): rotation is **irreversible** — there is ONE key slot and
   no key versioning, so files encrypted under the old key become permanently unreadable
   after a rotation. If encryption was never
   enabled, nothing was ever encrypted with the exposed key; simply generate a fresh key
   (`openssl rand -base64 32`) when you turn `STORAGE_ENCRYPT` on. If encrypted files DO
   exist, decrypt them first (download via the app while the old key is in place), rotate,
   and re-upload.

## Break-glass operations

```bash
docker compose exec app npm run breakglass issue [hours]   # provision (default 72h auto-expiry)
docker compose exec app npm run breakglass rotate          # new passphrase
docker compose exec app npm run breakglass disable         # turn off + clear credential
```

Break-glass is **off by default**, **owner-only**, argon2id-hashed, rate-limited, fully audited,
and **auto-expires**. A break-glass session is short-lived (30 min) and **cannot change auth
settings once any SSO sign-in has occurred** — during first-run bootstrap (no OIDC account
exists yet) it may perform the initial OIDC configuration, which is the only way to bring up
SSO on a fresh instance. The `BREAK_GLASS=on` env override forces it on and bypasses
auto-expiry — use only during active recovery.

## File storage

The compose stack defaults to `STORAGE_PROVIDER=local` with uploads in the
`uploads` **named volume**, mounted at `/data/uploads` in both the app and
worker containers — files survive image rebuilds and `docker compose up`
re-creates. Two things will silently break persistence: changing
`LOCAL_STORAGE_DIR` without moving the volume mount to match, or removing the
volume mount entirely (uploads then land in the container's writable layer and
vanish on the next rebuild — Settings → Organization shows a storage health
warning when this is detected). `docker compose down -v` deletes named volumes,
uploads included; back up the `uploads` volume alongside `db-data`.

## File storage on a network share (encrypted)

Uploads can live on a network share while staying encrypted at rest (the bind
mount **replaces** the default `uploads` named volume — compose merges volume
mounts by container path):

1. Mount the share on the Docker host (NFS or SMB/CIFS) and add it to
   `/etc/fstab` so it survives reboots. The app runs as uid/gid 1000, so CIFS
   must map ownership:

   ```
   //nas/property-files /mnt/property_manager cifs credentials=/root/.smbcreds,uid=1000,gid=1000,file_mode=0660,dir_mode=0770 0 0
   ```

2. Use the shipped override ([`docker-compose.nas.example.yml`](../docker-compose.nas.example.yml))
   via `.env`:

   ```
   COMPOSE_FILE=docker-compose.yml:docker-compose.nas.example.yml
   UPLOADS_HOST_PATH=/mnt/property_manager
   STORAGE_PROVIDER=local
   LOCAL_STORAGE_DIR=/data/uploads
   ```

3. **Move existing files first** — the named volume stops being mounted once
   the override is active:

   ```bash
   docker compose down app worker
   docker run --rm -v <project>_uploads:/from -v /mnt/property_manager:/to alpine cp -a /from/. /to/
   docker compose up -d
   ```

   (`<project>` is the compose project name, usually the repo directory name —
   `docker volume ls | grep uploads` shows it.) The entrypoint preflight fails
   the container with a clear message if the share is missing or not writable
   by uid 1000, so a broken mount can no longer silently strand uploads.
4. Set `STORAGE_ENCRYPT=true`. New uploads are AES-256-GCM encrypted before they
   touch the share (the share host never sees plaintext); files uploaded before
   enabling stay readable. The key comes from `STORAGE_ENC_KEY` (32 bytes,
   base64/hex) or, when unset, is derived from `SETTINGS_ENC_KEY` — **back that
   key up**; without it encrypted files are unrecoverable.

S3-compatible storage should use the provider's own at-rest encryption (SSE)
instead — presigned URLs hand bytes directly to the browser, so the app never
gets a chance to decrypt them.

## Backups & migrations

- Back up the **app** Postgres volume (`db-data`), the **uploads** volume
  (`uploads` — leases, receipts, the logo), and, separately, the Authentik
  volume if bundled (`authentik-db`) — keep them decoupled.
- [`scripts/backup.sh`](../scripts/backup.sh) does both in one shot (pg_dump +
  uploads tarball, named-volume and NAS layouts, retention via
  `RETENTION_DAYS`); run it from cron on the deploy host:
  `0 3 * * * cd /opt/property-manager && ./scripts/backup.sh`.
- Migrations apply automatically on app start (`RUN_MIGRATIONS=1`, single replica). For
  scale-out, move migration to a one-shot job/release step.
- The `AuditLog` table is append-only at the DB level (a trigger blocks UPDATE/DELETE).

## Moving to another machine

The code comes from git — only two things move by hand: **`.env`** (secrets; gitignored) and,
if you're keeping your data, a **database dump**. `node_modules/`, `.next/`, and
`lib/generated/` are disposable — they're rebuilt by `npm install` / the Docker build.
(No git remote available? Tar the project directory minus those rebuildable dirs instead.)

**On the old machine:**

```bash
# Dump the database (skip if you're starting fresh on the new machine):
docker compose exec -T db pg_dump -U pm -d property_manager > backup.sql
```

> `.env` holds **AUTH_SECRET, SETTINGS_ENC_KEY, and the setup token**. Transfer it (and the
> dump) over a secure channel (scp/AirDrop/USB), not email or a public share.

**On the new machine** (needs Docker; Node 20.19+ only if you'll develop there):

```bash
git clone https://github.com/stephenthecold/property-manager.git && cd property-manager
# …copy .env into the project root…
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
