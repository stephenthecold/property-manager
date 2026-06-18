# CLAUDE.md

Rental property-management platform. Phases 1–4.7 are built and deployed (core app, receipts,
SMS, reports, RBAC capability matrix, Financials/Maintenance modules, theming) — see
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what exists and
[`docs/PHASE5_PLAN.md`](docs/PHASE5_PLAN.md) for the next phase. This file is the working
guide; [`docs/`](docs/) has the details.

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

## Verification

Run this gate before treating a change as done (and before pushing / opening a PR). The first
line is non-negotiable and must pass; the skills automate the deeper review. A change is
"verified" only when **typecheck + tests + lint pass**, **`/verify` confirms runtime behavior**,
and **`/code-review` (plus `/security-review` where it applies) comes back clean**.

- **Static + unit gates (must be green):** `npm run typecheck` (tsc --noEmit), `npm test`
  (Vitest accounting units), and `npm run lint` (keep it zero-error). Any money/period/status
  change needs new/extended pure-module tests in [`lib/accounting/`](lib/accounting/).
- **`/verify`** — runs the app and exercises the change end-to-end to confirm it actually
  behaves as intended, not just that it compiles. Use **`/run`** when you only need to launch
  or drive the app (e.g. to capture a screenshot).
- **`/code-review`** — reviews the current diff for correctness bugs and reuse/simplification/
  efficiency issues. Add `--fix` to apply findings to the working tree, or `--comment` to post
  them inline on the PR.
- **`/security-review`** — required whenever a change touches auth/capabilities, the ledger,
  money handling, the tenant portal, file storage, or audit logging (i.e. most of the
  Non-negotiable conventions below). Reviews the pending changes on the branch.
- **`/simplify`** — optional quality pass for reuse/altitude cleanups once the change is
  correct; it does not hunt for bugs (use `/code-review` for that).
- **`/review`** — review an existing pull request when verifying someone else's PR rather than
  your own working-tree diff.

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
- **Optional modules** (Financials, Maintenance, Tenant Portal) are flags on
  `AppSettings.modules` (Settings → Modules). Module pages `redirect("/dashboard")` and module
  actions throw via `assertModuleEnabled` when off; **disabling only hides UI — never delete
  module data**. `PropertyExpense`/`MaintenanceJob`/`TenantRequest` are operating records, NOT
  ledger entries: they never touch tenant balances. Financing (mortgage) and purchase date are
  **Property-level** fields.
- **Tenant portal is a separate LOCAL auth lane**: `/portal` + `/api/portal` are staff-middleware
  PUBLIC_PREFIXES; the only gate is `lib/portal/session.ts` (opaque 256-bit cookie tokens stored
  as sha-256 hashes — never NextAuth/OIDC/staff `User` rows). Every portal page/action re-checks
  the portal session AND scopes queries to the signed-in tenant; portal file downloads go through
  `/api/portal/files/[id]` (ownership-checked), never `/api/files`. Credentials live in
  `lib/services/portal-auth.ts` (argon2id passwords via invite links, hashed 6-digit SMS codes,
  lockouts, enumeration-safe generic responses).

## UI conventions

- **Lists use [`DataTable`](components/app/data-table.tsx)** (client sort + 10/20/50
  pagination). The server page renders every cell (links, badges, server-action forms) and
  passes them in; money sort values cross the boundary as `String(cents)`.
- **Add/edit forms live in [`FormDialog`](components/app/form-dialog.tsx)** pop-outs (server
  forms passed as children; closes on submit + refreshes). Keep the saved values visible on
  the page outside the dialog.
- **Two themes** via CSS variables in [`app/globals.css`](app/globals.css): `:root` =
  "Slate & Sky" light, `.dark` = "Navy Night" dark (next-themes class toggle in the header).
  Rules: never `bg-transparent` on form controls (native selects/textareas are themed by a
  base-layer rule); every colored tint (`bg-*-100`-style badge) needs `dark:` variants; print
  always forces light variables. Client components reading the theme must avoid
  hydration-attribute mismatches (constant labels, mount-gated icons — see `theme-toggle.tsx`).
- **Branding**: the Settings → Organization logo renders in the header and as the favicon
  (`app/icon.tsx`, `force-dynamic`).

## Gotchas

- **Prisma 7**: new `prisma-client` generator → import from `@/lib/generated/prisma/client`;
  driver adapter (`@prisma/adapter-pg`) in [`lib/db.ts`](lib/db.ts); URL via `prisma.config.ts`.
- **shadcn uses Base UI**, not Radix: compose with `render={<Comp/>}`, not `asChild`.
- `server-only` is kept ONLY on UI-only guards (`lib/auth/session.ts`, `setup.ts`, `oidc-test.ts`)
  so the worker/seed/CLI (plain Node via tsx) can import the data services.
- Add `export const dynamic = "force-dynamic"` to DB-reading public pages so `next build`
  doesn't prerender them against a DB.
- **File storage**: `STORAGE_ENCRYPT=true` wraps the LOCAL provider with AES-256-GCM at rest
  (network-share use; key = `STORAGE_ENC_KEY` or HKDF of `SETTINGS_ENC_KEY` — losing it makes
  files unrecoverable). `/api/files` decrypts on serve; old plaintext files stay readable.
  S3 should use bucket SSE instead (presigned URLs bypass the app).
- Batch accounting reads with `batchLeaseSnapshots()` (2 queries for N leases) instead of
  calling `leaseSnapshot()` in a loop; both share the same pure compute.
- `npm run lint` is clean (zero errors); keep it that way.

When extending (Phases 2–5), attach to existing seams (`sourceType/sourceId`, provider
interfaces, `AuditLog`) rather than reshaping the schema. See [`docs/ROADMAP.md`](docs/ROADMAP.md).
