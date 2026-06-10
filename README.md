# Property Manager

A self-hostable rental-property management app for small-to-mid landlords:
**Property → Building → Unit → Tenant → Lease → Payment**, with ledger-based rent tracking,
overdue detection, a dashboard, and reports.

- **Ledger-based accounting** — every balance is a pure sum of an append-only ledger; payments
  are never hard-deleted (corrections are reversals). Strict per-charge **FIFO** allocation with
  aging, idempotent rent-charge + late-fee generation, money as exact integer cents.
- **Digital receipts & document uploads** — every payment gets a numbered, printable receipt
  (`RCT-YYYYMMDD-NNNN`); photo/PDF uploads attach to tenants/payments/receipts with a
  create-payment-from-document review flow and an optional OCR scaffold. Local-disk or
  S3-compatible storage.
- **SMS reminders** — manual, bulk-overdue, and scheduled (due-soon/overdue) reminders with
  consent enforcement, idempotent sends, Twilio support (stub by default), and a
  delivery-status webhook.
- **Reports & audit** — rent roll, overdue, cash income summary, lease expirations,
  payments-by-method, tenant/unit ledgers (CSV + on-screen), list search/filters, and a
  read-only audit-log viewer over the append-only audit trail.
- **Web-configurable settings** — white-labeling (business name, logo, receipt footer, org
  defaults) and messaging (SMS provider with encrypted Twilio credentials, reminder behavior,
  editable message templates, test send) under Settings; owner-only and fully audited.
- **Self-hosted auth** — Authentik (OIDC) with a web config UI, an installer, and a hardened
  **break-glass** emergency login for when SSO is unavailable.
- **Runs as Docker Compose** — Postgres + app + billing/reminder worker; Authentik, MinIO, and
  Caddy behind optional profiles.

## Quick start

```bash
git clone https://github.com/stephenthecold/property-manager.git
cd property-manager
cp .env.example .env
npm install
npm run bootstrap          # generate AUTH_SECRET / SETTINGS_ENC_KEY / SETUP_BOOTSTRAP_TOKEN
docker compose up -d       # app + db + worker (builds the image on first run)
```

Then open `http://localhost:3000/setup?token=<SETUP_BOOTSTRAP_TOKEN>` (the token is printed by
`npm run bootstrap`) to create the first owner, get an emergency login with

```bash
docker compose exec app npm run breakglass issue   # run INSIDE the stack — the host can't reach the `db` host
```

and configure SSO under **Settings → Authentication**. Full steps: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Seed demo data: set `SEED_ON_START=true` (or `npm run db:seed`).

## Updating

```bash
git pull && docker compose up -d --build   # rebuild from source; migrations run on start
```

Or skip local builds entirely: CI publishes the image to GHCR on every push to main
(`.github/workflows/docker-publish.yml`). Set `APP_IMAGE=ghcr.io/<owner>/property-manager:latest`
in `.env`, then update with `docker compose pull app worker && docker compose up -d`.

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
