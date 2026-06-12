# CLAUDE.md

Rental property-management platform. Phase 1 is built and runnable. The original product spec
is in the repo owner's notes; this file is the working guide. See [`docs/`](docs/) for details.

## Commands

```bash
npm run dev            # dev server (Next 16, turbopack)
npm test               # Vitest accounting unit tests
npm run typecheck      # tsc --noEmit
npm run prisma:deploy  # apply migrations    | npm run prisma:migrate (create in dev)
npm run db:seed        # idempotent seed
npm run worker         # billing worker (charges + late fees)
npm run bootstrap      # generate secrets into .env (deploy hosts: ./scripts/bootstrap.sh, no Node)
npm run breakglass issue|rotate|disable
docker compose up -d   # app + db + worker  (profiles: idp, storage, proxy)
```

## Non-negotiable conventions

- **Money is integer cents (`bigint`)**, only ever touched through [`lib/money.ts`](lib/money.ts).
  Never floats, never `Number(cents)` for math. Cross the RSC→client boundary as strings.
- **The ledger is the source of truth.** Balance = `SUM(amountCents)` over *all* `LedgerEntry`
  rows for a lease (no void filter). **Never hard-delete payments or mutate entries** —
  corrections are offsetting `reversal` entries. See [`docs/accounting.md`](docs/accounting.md).
- **All money/period/status logic lives in pure modules** ([`lib/accounting/`](lib/accounting/),
  clock-injected, DB-free) and is unit-tested. [`lib/services/`](lib/services/) only bridges
  Prisma ↔ those functions. Don't re-implement balance math in queries or components.
- **Charge/late-fee generation is idempotent** via partial unique indexes
  `UNIQUE(leaseId, periodKey) WHERE entryType IN (rent_charge|late_fee)` (raw SQL migration);
  payments are idempotent via a client-minted `idempotencyKey`. Period math is in the property
  timezone (Luxon).
- **Auth**: `proxy.ts` (edge) uses `auth.config.ts` (JWT-only, no Prisma, fails closed);
  `auth.ts` (Node) has the adapter + dynamic OIDC provider built from the DB `AuthSettings`.
  JWT role is a hint. **Gate mutations/sensitive pages with `requireCapability(cap)`** (and API
  routes with `authorizeApiCapability`) — the capability layer (`lib/auth/permissions.ts`) is
  DB-authoritative (+ `securityStamp`) and configurable per role at Settings → Permissions; its
  defaults reproduce the old `requireRole` hierarchy. Use bare `requireRole` only for a hard
  role floor. New capability? Add it to `CAPABILITIES`, map a default in `MIN_ROLE`, and update
  the `permissions.test.ts` legacy-equivalence map.
  Break-glass is off by default, owner-only, auto-expiring, and cannot change auth settings
  once any OIDC sign-in exists (first-run bootstrap may do the initial OIDC configuration).
- **Every mutation is audited** in-transaction via `withAudit`/`writeAudit`; `AuditLog` is
  append-only (DB trigger).

## Gotchas

- **Prisma 7**: new `prisma-client` generator → import from `@/lib/generated/prisma/client`;
  driver adapter (`@prisma/adapter-pg`) in [`lib/db.ts`](lib/db.ts); URL via `prisma.config.ts`.
- **shadcn uses Base UI**, not Radix: compose with `render={<Comp/>}`, not `asChild`.
- `server-only` is kept ONLY on UI-only guards (`lib/auth/session.ts`, `setup.ts`, `oidc-test.ts`)
  so the worker/seed/CLI (plain Node via tsx) can import the data services.
- Add `export const dynamic = "force-dynamic"` to DB-reading public pages so `next build`
  doesn't prerender them against a DB.

When extending (Phases 2–5), attach to existing seams (`sourceType/sourceId`, provider
interfaces, `AuditLog`) rather than reshaping the schema. See [`docs/ROADMAP.md`](docs/ROADMAP.md).
