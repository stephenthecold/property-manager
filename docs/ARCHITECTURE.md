# Architecture

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **PostgreSQL** via **Prisma 7** (driver adapter `@prisma/adapter-pg`; no Rust engine)
- **Auth.js v5** (NextAuth) — Authentik OIDC + break-glass credentials, JWT sessions
- **Tailwind v4** + **shadcn/ui** (Base UI primitives)
- **Vitest** for the accounting unit tests
- Runs as a **Docker Compose** stack; one image serves the app, the billing worker, and migrations

## Directory map

```
app/
  login/  emergency/  setup/        # public auth pages (no shell)
  (app)/                            # authenticated shell (layout = auth + nav + theme toggle)
    dashboard/ properties/ buildings/ units/ tenants/ leases/ payments/ documents/
    reminders/ reports/ financials/ maintenance/ audit/ settings/*   # settings: org, billing,
                                    # messaging, auth, users, permissions, modules
  api/auth/[...nextauth]/           # Auth.js route handler (Node runtime)
  api/reports/[type]/               # CSV export (capability-gated)
  icon.tsx                          # dynamic favicon (uploaded logo, force-dynamic)
auth.config.ts                      # edge-safe Auth.js config (JWT only, no Prisma)
auth.ts                             # Node Auth.js instance (Prisma adapter + dynamic providers)
proxy.ts                            # edge middleware (Next 16 "proxy" convention)
components/
  app/data-table.tsx                # client sort/pagination over server-rendered rows
  app/form-dialog.tsx               # pop-out dialog around server-action forms
  app/theme-toggle.tsx              # light/dark switch (next-themes)
lib/
  money.ts                          # currency choke-point (bigint cents)
  accounting/                       # pure: ledger, allocation (FIFO), periods (tz), status, fees
  services/                         # DB↔accounting bridge: accounting, payments, billing,
                                    # dashboard, reports, financials, app-settings, storage-status
  auth/                             # crypto, settings (encrypted OIDC config), rbac, permissions
                                    # (capability matrix), providers, breakglass, session, setup
  providers/                        # storage (local/S3/stub + encrypted wrapper) + sms (twilio/stub)
  audit/                            # append-only audit helper
  config/env.ts                     # zod-validated env (fail fast)
  db.ts                             # Prisma client singleton (driver adapter)
  generated/prisma/                 # generated Prisma client (gitignored)
worker/                             # node-cron billing worker
scripts/bootstrap.ts                # installer + breakglass CLI
prisma/                             # schema, migrations (incl. raw-SQL partial indexes), seed
```

## Key invariants

- **Ledger is truth** — see [accounting.md](./accounting.md). Balance is a pure sum; never a
  stored mutable column. Payments are never hard-deleted (void = offsetting reversal).
- **Money is bigint cents**, formatted/parsed only in `lib/money.ts`.
- **Auth edge/node split**: `proxy.ts` uses `auth.config.ts` (JWT decode only, no DB) and
  **fails closed**; the DB-backed provider/jwt logic lives in `auth.ts` (Node runtime). The
  JWT role is a *hint*; `requireRole` does an authoritative DB check (+ `securityStamp`
  revocation) for sensitive actions.
- **Capability layer over roles**: `lib/auth/permissions.ts` maps 13 capabilities to roles.
  Mutations/sensitive pages call `requireCapability(cap)` (and API routes
  `authorizeApiCapability`) instead of a bare role. The default matrix exactly reproduces the
  role hierarchy; an owner/admin can re-assign capabilities per role at Settings → Permissions
  (stored as a `rolePermissions` override on `AppSettings`, `{}` = defaults). Owner always has
  all; a few admin capabilities are locked on so a bad matrix can't lock admins out.
- **Every mutation is audited** in the same transaction (`withAudit` / `writeAudit`).
  `AuditLog` is append-only (DB trigger blocks UPDATE/DELETE).
- **Optional modules** (Financials, Maintenance) are flags on `AppSettings.modules`
  (Settings → Modules). Disabling hides UI and blocks module actions
  (`assertModuleEnabled`) but never deletes data. `PropertyExpense` /
  `MaintenanceJob` / `RecurringTask` are operating records, NOT ledger entries —
  they never touch tenant balances. Financing (monthly mortgage + maturity) and
  the purchase date live on `Property` (parcel-level, not per building).

## UI layer

- **Theme system**: two CSS-variable themes in `app/globals.css` — `:root`
  ("Slate & Sky" light) and `.dark` ("Navy Night" dark) with gradient body
  backgrounds — switched by `next-themes` (class attribute) via the header
  toggle. Print media always forces light variables. Native selects/textareas
  get a themed surface from a base-layer rule; any colored tint
  (`bg-*-100`-style badges) must carry `dark:` variants.
- **`DataTable`** (client) sorts/paginates rows whose cells were rendered on
  the server (links, badges, server-action forms pass through as serialized
  RSC payload); money sort values cross the boundary as `String(cents)`.
- **`FormDialog`** (client) wraps a server-rendered, server-action form in a
  pop-out dialog; it closes on submit and refreshes the route. Saved values
  stay visible on the page outside the dialog.
- **Branding**: the uploaded logo (Settings → Organization) renders in the app
  header and as the favicon (`app/icon.tsx`, `force-dynamic`, letter-tile
  fallback).

## Provider abstractions

`FileStorage` and `SmsProvider` are interfaces selected by an env factory, defaulting to
no-op **stubs** so Phase 1 runs with zero external services. Phase 2/3 swap in S3/MinIO and
Twilio/Telnyx by config only. With `STORAGE_ENCRYPT=true` the local provider is wrapped by
`EncryptedFileStorage` (AES-256-GCM at rest, `PMENCv1` header; key from `STORAGE_ENC_KEY` or
HKDF-derived from `SETTINGS_ENC_KEY`; pre-existing plaintext stays readable) — intended for
`LOCAL_STORAGE_DIR` on a mounted network share; S3 should use provider-side SSE instead
because presigned URLs bypass the app.

## Auth & audit models

- `User` (role, `securityStamp`), `Account` (OIDC linking), `AuthSettings` (single row,
  AES-256-GCM-encrypted client secret, group→role mappings, break-glass flags),
  `BreakGlassCredential` (argon2id), `AuditLog`.
- See [AUTHENTIK.md](./AUTHENTIK.md) for the OIDC setup and [DEPLOYMENT.md](./DEPLOYMENT.md)
  for the HTTPS/secret/break-glass operational model.
