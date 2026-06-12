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
  (app)/                            # authenticated shell (layout = auth + nav)
    dashboard/ properties/ buildings? units/ tenants/ leases/ payments/ reports/ settings/auth/
  api/auth/[...nextauth]/           # Auth.js route handler (Node runtime)
  api/reports/[type]/               # CSV export
auth.config.ts                      # edge-safe Auth.js config (JWT only, no Prisma)
auth.ts                             # Node Auth.js instance (Prisma adapter + dynamic providers)
proxy.ts                            # edge middleware (Next 16 "proxy" convention)
lib/
  money.ts                          # currency choke-point (bigint cents)
  accounting/                       # pure: ledger, allocation (FIFO), periods (tz), status, fees
  services/                         # DB↔accounting bridge: accounting, payments, billing, dashboard, reports
  auth/                             # crypto, settings (encrypted OIDC config), rbac, providers, breakglass, session, setup
  providers/                        # storage (S3/stub) + sms (twilio/stub) interfaces
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

## Provider abstractions

`FileStorage` and `SmsProvider` are interfaces selected by an env factory, defaulting to
no-op **stubs** so Phase 1 runs with zero external services. Phase 2/3 swap in S3/MinIO and
Twilio/Telnyx by config only.

## Auth & audit models

- `User` (role, `securityStamp`), `Account` (OIDC linking), `AuthSettings` (single row,
  AES-256-GCM-encrypted client secret, group→role mappings, break-glass flags),
  `BreakGlassCredential` (argon2id), `AuditLog`.
- See [AUTHENTIK.md](./AUTHENTIK.md) for the OIDC setup and [DEPLOYMENT.md](./DEPLOYMENT.md)
  for the HTTPS/secret/break-glass operational model.
