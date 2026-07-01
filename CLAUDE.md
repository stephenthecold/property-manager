# CLAUDE.md

Rental property-management platform. Phases 1–4.7 are built and deployed (core app, receipts,
SMS, reports, RBAC capability matrix, Financials/Maintenance modules, theming) — see
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what exists and
[`docs/PHASE5_PLAN.md`](docs/PHASE5_PLAN.md) for the next phase. Several Phase-5 batches of
enterprise-gap features have since shipped — two-way SMS inbox, ⌘K global search, per-tenant activity
timeline, work-order lifecycle, preventive-maintenance log, asset/warranty registry + warranty
alerts, lease-expiration alerts, portal notices, lease abstract, reminder delivery tracking,
maintenance/audit photos & CSV export; renewals, lease amendments, deposit→ledger move-out,
inspection templates, turnover/make-ready; a payments module (offline self-report → staff confirm),
an own-LLC portfolio rollup, a public `/vacancies` page, report PDF/Excel export + scheduled
delivery, email-bounce + reminder-preference hardening, optional staff 2FA/TOTP, and an app-wide
UI-consistency harden; most recently a reliability/compliance hardening pass — SMS numbers
normalized to E.164 with an auto-consent-request on first contact (held + released on opt-in),
two-way Telnyx SMS with signature-verified inbound/delivery webhooks, a timezone-resilient billing
worker (hourly by default, with a stale-run dashboard warning), granular staff alert toggles
(payment recorded, new maintenance request) plus a self-cleaning consent-flow test command, and
org-timezone rendering for every staff-page timestamp — the prioritized enterprise-gap backlog
([`docs/IMPROVEMENT_BACKLOG.md`](docs/IMPROVEMENT_BACKLOG.md))
tracks what shipped, what's left, and the pending live-DB verification pass (refresh it with
`/competitive-audit`; turn an item into a build with `/feature-intake`). This file is the working
guide; [`docs/`](docs/) has the details.

## Working agreement

- **State the verification plan first.** Before starting any task, say how you'll verify it —
  which checks/skills from [Verification](#verification), and for user-visible work how you'll
  render and observe it. No work begins without a verification plan.
- **Verify and report after.** When done, actually run that verification and report results: what
  passed, and what you couldn't check and why. "It typechecks" is not proof the behaviour works.
- **Parallelize with agents.** Independent work should run concurrently, not serially. Fan out
  subagents — one per feature/area for **development** (use `isolation: "worktree"` when they edit
  the tree at the same time so branches don't collide), and run **verification** in parallel too
  (`/code-review`, `/security-review`, and the typecheck/test/lint gate as separate agents). Hand
  each a crisp spec + the [Verification](#verification) gate, launch them in one batch, then
  reconcile their results before pushing. Same fan-out for research (`/competitive-audit`).
- **Hot zones — ask first.** Before changing any code in a hot zone (below), STOP and ask, and
  explain the **blast radius** (what breaks, who's affected, whether it's reversible). Don't touch
  it until the user says go. Hot zones — money, auth, and anything irreversible:
  - **Money & ledger** — [`lib/money.ts`](lib/money.ts), [`lib/accounting/`](lib/accounting/),
    and ledger writes / `postPayment` / reversals in [`lib/services/`](lib/services/). *A bug
    corrupts balances for every lease.*
  - **Payments** — [`app/(app)/payments/`](app/(app)/payments), payment providers in
    [`lib/providers/payment/`](lib/providers/payment), the gateway webhook
    [`app/api/payments/webhook`](app/api/payments/webhook), idempotency keys. *Double charges,
    lost or duplicated payments.*
  - **Auth & capabilities** — `proxy.ts`, `auth.ts`, `auth.config.ts`,
    [`lib/auth/permissions.ts`](lib/auth/permissions.ts), [`lib/auth/session.ts`](lib/auth/session.ts),
    break-glass. *App-wide lockout or privilege escalation.*
  - **Portal/payer auth lanes** — [`lib/portal/session.ts`](lib/portal/session.ts),
    [`lib/payer-portal/session.ts`](lib/payer-portal/session.ts),
    [`lib/services/portal-auth.ts`](lib/services/portal-auth.ts). *A tenant/payer seeing another's
    data.*
  - **Schema & migrations** — [`prisma/schema.prisma`](prisma/schema.prisma) +
    [`prisma/migrations/`](prisma/migrations). *Irreversible data change on deploy; migrations only
    run forward.*
  - **Audit & billing worker** — [`lib/audit/`](lib/audit) (append-only) and
    [`lib/services/billing.ts`](lib/services/billing.ts) + the charge/late-fee idempotency indexes.
    *A weakened audit trail, or duplicate/missed charges across all active leases.*

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

Every change must clear this gate before commit/push — never skip it:

```bash
npm run typecheck        # tsc --noEmit — zero errors
npm test                 # Vitest pure-logic suite — all green
npm run lint             # ESLint — zero errors (keep it clean)
npm run prisma:generate  # after ANY prisma/schema.prisma edit (runs offline, no DB)
```

Then reach for the skill that matches the change — these are the verification tools, use them rather than eyeballing the diff:

- **`/code-review`** — review the current diff for correctness bugs + reuse/simplification cleanups. Run on every non-trivial diff (`--fix` applies findings, `--comment` posts them inline on the PR).
- **`/simplify`** — quality-only pass (reuse/simplification/efficiency) when you don't need bug-hunting.
- **`/security-review`** — required for anything touching auth/capabilities, portal/payer sessions, file serving, webhooks, money, or any new external surface.
- **`/run`** — launch and drive the app to confirm a change works for real (and to screenshot UI work).
- **`/verify`** — run the app and observe behaviour to prove a user-visible/behavioural change actually does what it should. Use before claiming any such change works.

**Types + unit tests do NOT cover rendered pages, migrations, or the worker schedule** — those need a live DB + a session. Stand one up, then drive it with `/run` or `/verify`:

```bash
docker compose up -d db   # Postgres (or the full stack: docker compose up -d)
npm run prisma:deploy     # apply migrations    npm run db:seed   # seed data
npm run breakglass issue  # one-time owner login when no OIDC is configured
npm run dev               # open the app / let /run drive it
```

UI/visual and behavioural changes are not "done" until rendered and observed. If no DB/browser is available in the environment, say so explicitly and flag the change for a visual check — never report it verified on types alone.

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
- **Maintenance jobs have a multi-state lifecycle** (`MaintenanceJobStatus`: pending/assigned/
  in_progress/on_hold/completed/canceled). Test "is this job open?" with `isOpenStatus()` /
  `OPEN_STATUSES` from [`lib/maintenance/status.ts`](lib/maintenance/status.ts) — never
  `status === "pending"`. Completion (cost → `PropertyExpense` mirror) is still tied to `completed`.
- **Instant timestamps render in the org timezone, not the server's.** RSC pages format `Date`
  instants (created/received/sent/handled/reported/last-login/delivered/etc.) with whatever
  timezone the *container* runs in (UTC) by default — a bare `date.toLocaleString()` reads hours
  in the future for a behind-UTC org. Use `formatDateTime`/`formatDate`/`formatDateLong` from
  [`lib/ui/datetime.ts`](lib/ui/datetime.ts) with `AppSettings.defaultTimezone` instead; they fall
  back to an ISO string if the (free-text, unvalidated) org timezone is invalid rather than
  throwing. Civil date-only fields (due/effective/payment dates) already pin their own zone —
  leave those alone.
- **Billing worker cron defaults to hourly** (`BILLING_CRON`, `0 * * * *`) so a behind-UTC
  property's midnight rollover doesn't sit uncharged for most of a day (a charge is only "due"
  once midnight arrives in the *property's* timezone). Each completed run stamps
  `AppSettings.lastBillingRunAt`; the dashboard warns if it's gone stale
  ([`lib/dashboard/billing-health.ts`](lib/dashboard/billing-health.ts), >26h).
- `npm run lint` is clean (zero errors); keep it that way.

When extending (Phases 2–5), attach to existing seams (`sourceType/sourceId`, provider
interfaces, `AuditLog`) rather than reshaping the schema. See [`docs/ROADMAP.md`](docs/ROADMAP.md).
