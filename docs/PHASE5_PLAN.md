# Phase 5 — Next large phase (plan)

Phases 1–4.5 are built (see [ROADMAP.md](./ROADMAP.md)). This is the actionable plan for the
next phase. Everything here attaches to existing seams so the schema and core invariants don't
get reshaped:

- **Money** stays integer cents through `lib/money.ts`; the **ledger is the source of truth**
  (corrections are reversals, never edits — see [accounting.md](./accounting.md)).
- **Pure logic** lives in `lib/accounting/*` (clock-injected, DB-free, unit-tested);
  `lib/services/*` only bridges Prisma ↔ those functions.
- **Authorization** goes through the capability layer (`requireCapability` /
  `authorizeApiCapability`, `lib/auth/permissions.ts`) — new surfaces add a capability, not a
  bare role.
- **Every mutation** is audited in-transaction (`withAudit`/`writeAudit`); external integrations
  attach via `sourceType`/`sourceId` and provider interfaces.

The workstreams are independent and can ship one PR at a time.

---

## A. Tenant portal (foundational)

A separate, low-privilege surface for tenants to see their balance/ledger and pay.

- **Identity**: a `Tenant`↔login link distinct from staff `User`s (own auth, no role in the
  staff hierarchy). Magic-link or OTP email/SMS sign-in reusing the SMS provider; portal
  sessions never carry staff capabilities.
- **Scope guard**: every portal query is keyed by the authenticated tenant id; add a
  `requirePortalTenant()` analogous to `requireCapability`, and a row-ownership check so a
  tenant can only ever read their own lease/ledger/receipts.
- **Views**: current balance + aging, ledger (read-only), receipts (reuse `/receipts/[id]`),
  documents shared *to* them.
- **Acceptance**: a tenant can authenticate, see only their data, and never reach a staff route
  (verified with a Playwright cross-tenant access test).

## B. Online payments (ACH / card)

- **Provider interface** `PaymentGateway` mirroring `SmsProvider`/`FileStorage`: `stub` default,
  one real adapter (Stripe-style) selected by config. Secrets via env + the existing
  `SETTINGS_ENC_KEY` encryption pattern (like the Twilio token).
- **Ledger integration**: a gateway success posts a normal payment through the *existing*
  payment service (FIFO allocation, idempotency key, audit) with `sourceType="gateway"` and the
  provider reference in `sourceId` — no new balance math.
- **Webhooks**: `/api/payments/webhook` verified by provider signature (reuse the
  Twilio-signature verification shape); idempotent on the provider event id.
- **Acceptance**: a stubbed gateway round-trip creates exactly one posted payment + receipt;
  replaying the webhook is a no-op.

## C. Email channel

- Generalize reminders/receipts to a `NotificationChannel` ("sms" | "email"); add an
  `EmailProvider` interface (`stub` default, SMTP/provider adapter). Reuse the template renderer
  and the consent/idempotency rules already proven for SMS.
- **Acceptance**: a receipt and an overdue reminder can be sent by email behind a per-tenant
  channel preference; consent is still absolute.

## D. Maintenance tickets

- New `MaintenanceTicket` (unit/tenant ref, status, priority, audit) + a thread of updates and
  attachments (reuse `UploadedDocument` via `sourceType`). A capability `maintenance.manage`.
- Optional tenant-portal submission (depends on A).
- **Acceptance**: staff CRUD with full audit; documents attach via the existing upload path.

## E. Settings: DB-overridable storage & branding

- Mirror the SMS DB-over-env pattern for **non-secret** storage config (provider, bucket,
  region, endpoint, path-style, local dir) on `AppSettings`; **secrets stay in env**. Requires
  threading a resolved config into the storage factory/providers (today they read env in their
  constructors) and a `resolveFileStorage()` that merges DB over env.
- Builds directly on the read-only storage status panel already in Settings → Organization.
- **Acceptance**: switching bucket/endpoint from the UI takes effect without redeploy; secrets
  are never written to or read from the DB.

## F. Performance backlog (from the audit, not yet done)

These are safe, isolated follow-ups to the 4.5 batching work:

- Batch `loadLeaseAccounting` in the **reminder worker** sweeps (`lib/services/reminders.ts`
  bulk-overdue and scheduled loops) and parallelize sends within provider rate limits.
- `select` down the heavy report/income queries (`getTenantLedger`, `getIncomeSummary`) to the
  columns actually used.
- Composite index `Reminder(leaseId, reminderType, periodKey)` for the idempotency lookup and
  `Reminder(tenantId, createdAt)` for the tenant timeline.
- Single-pass dashboard unit-occupancy aggregation; `select` names-only on recent payments.

## G. Security backlog

- Re-run `/security-review` on each portal/payment PR (new external surfaces).
- Bump break-glass passphrase entropy to 256 bits (`randomToken(32)`).
- Consider per-resource ownership checks once multi-tenant data isolation (org_id) is on the
  table.

---

### Suggested order

A and B are the high-value foundation (and B's ledger integration is low-risk because it reuses
the payment service). C and D layer on once A exists. E, F, G are independent and can slot in
between as smaller PRs. Keep each workstream to its own PR with tests + a Playwright check, the
way 4.5 was shipped.
