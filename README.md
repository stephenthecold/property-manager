# Property Manager

A self-hostable rental-property management app for small-to-mid landlords:
**Property → Building → Unit → Tenant → Lease → Payment**, with ledger-based rent tracking,
overdue detection, a dashboard, and reports.

- **Ledger-based accounting** — every balance is a pure sum of an append-only ledger; payments
  are never hard-deleted (corrections are reversals). Strict per-charge **FIFO** allocation with
  aging, idempotent rent-charge + late-fee generation, money as exact integer cents.
- **Self-hosted auth** — Authentik (OIDC) with a web config UI, an installer, and a hardened
  **break-glass** emergency login for when SSO is unavailable.
- **Runs as Docker Compose** — Postgres + app + billing worker; Authentik, MinIO, and Caddy
  behind optional profiles.

## Quick start

```bash
cp .env.example .env
npm install
npm run bootstrap          # generate AUTH_SECRET / SETTINGS_ENC_KEY / SETUP_BOOTSTRAP_TOKEN
docker compose up -d       # app + db + worker
```

Then open `http://localhost:3000/setup?token=<SETUP_BOOTSTRAP_TOKEN>` (the token is printed by
`npm run bootstrap`) to create the first owner, get an emergency login with

```bash
docker compose exec app npm run breakglass issue   # run INSIDE the stack — the host can't reach the `db` host
```

and configure SSO under **Settings → Authentication**. Full steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Seed demo data: set `SEED_ON_START=true` (or `npm run db:seed`).

## Local development

```bash
# Postgres (or use the compose db):
docker run -d --name pm-postgres-dev -e POSTGRES_USER=pm -e POSTGRES_PASSWORD=pm \
  -e POSTGRES_DB=property_manager -p 5433:5432 postgres:17-alpine
npm run prisma:deploy && npm run db:seed
npm run dev                # http://localhost:3000
npm test                   # accounting unit-test matrix
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — stack, directory map, invariants
- [Accounting model](docs/accounting.md) — money/ledger/FIFO/late-fee/status rules
- [Authentik / OIDC setup](docs/AUTHENTIK.md)
- [Deployment & operations](docs/DEPLOYMENT.md) — TLS, secrets, break-glass, backups
- [Roadmap](docs/ROADMAP.md) — Phases 2–5 and how they attach to existing groundwork

## Tech

Next.js 16 · React 19 · TypeScript · Prisma 7 + PostgreSQL · Auth.js v5 · Tailwind v4 +
shadcn/ui · Vitest · Docker Compose.
