# Phase 5 — Next large phase (plan)

Phases 1–4.7 are built (see [ROADMAP.md](./ROADMAP.md)), and several Phase 5 workstreams have
since shipped — **A (tenant portal)** is built, and the **F/G** backlog and parts of **H** have
landed (see the per-section status notes below). This is the actionable plan for the rest of the
phase. Everything here attaches to existing seams so the schema and core invariants don't get
reshaped:

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

## A. Tenant portal (foundational) ✅ built

A separate, low-privilege surface for tenants to see their balance/ledger and pay. **Shipped**:
a local auth lane (`/portal` + `/api/portal`, opaque hashed cookie tokens in
`lib/portal/session.ts`), tenant-scoped balance/ledger/receipts/documents views, invite links +
SMS-code sign-in (`lib/services/portal-auth.ts`), and staff impersonation/trial-login. Online
payment from the portal still depends on **B**.

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

## B. Online payments (ACH / card) ✅ seam + stub built

- ✅ **Done — provider interface** `PaymentGateway`
  ([`lib/providers/payment/`](../lib/providers/payment/)) mirroring `SmsProvider`/`FileStorage`:
  `stub` default (deterministic, no real charges), env-selected via `PAYMENT_GATEWAY`. The
  gateway only verifies + normalizes a webhook into a `GatewayPaymentEvent`; the shared webhook
  secret stays in env (`PAYMENT_WEBHOOK_SECRET`). 10 unit tests.
- ✅ **Done — ledger integration**: `lib/services/gateway-payments.ts` posts a verified event
  through the *existing* `postPayment` service (FIFO allocation, audit, receipt) — **no new
  balance math**. The provider reference is stored on the `Payment` (referenceNumber) and the
  payment is idempotent on the provider event id (`idempotencyKey = gateway:<name>:<eventId>`).
- ✅ **Done — webhook**: `POST /api/payments/webhook` (public prefix; verified by the provider
  signature, not a session), idempotent on the provider event id — replaying a webhook is a no-op.
- **Acceptance met (logic):** a stubbed verified event creates exactly one posted payment +
  receipt via the existing service; a replay returns `duplicate`. **Still to do for production:** a
  real adapter (Stripe-style) behind the same interface — `createCheckout`/intent + that
  provider's signature scheme + a "Pay now" button in the tenant portal.

## C. Email channel ✅ built

- ✅ **Done** — reminders generalized to a `NotificationChannel` (sms | email) with a per-tenant
  preference (`Tenant.reminderChannel`) and `Tenant.emailConsent`. The pure
  `lib/reminders/channel.ts` (`resolveReminderDelivery`) keeps **consent absolute and
  per-channel** and never cross-sends; `sendReminder`/`retryExistingSlot` route through the
  resolved channel and reuse the existing SMTP `EmailProvider` + template renderer
  (`DEFAULT_EMAIL_SUBJECTS` adds subjects). Receipt-by-email already shipped in 4.75.
- A tenant has one preferred channel, so the existing
  `(leaseId, tenantId, reminderType, periodKey)` idempotency slot is unchanged — `channel` is an
  attribute of the one row (no index change).
- Still pending (small): portal self-service for the email-consent toggle / channel preference
  (staff can set both today); the email *receipt/partial-balance* auto-sends as scheduled types.

## D. Maintenance tickets ✅ built (core)

- ✅ **Done** — `MaintenanceJob` gains a triage **`priority`** (`MaintenancePriority`:
  low/normal/high/urgent) and a threaded **`MaintenanceUpdate`** progress log (append-only,
  audited). Staff set priority on create, change it (audited), and post updates from the
  maintenance page; pure `lib/maintenance/priority.ts` (parse/label/sort) is unit-tested. Gated by
  the existing `maintenance.manage` capability. Tenant-portal submission already exists via
  `TenantRequest` (→ convert to a job).
- ✅ **Done — attachments:** a loose `UploadedDocument.maintenanceJobId` ref lets staff attach
  photos/invoices (image or PDF, ≤10 MB) to a job via a "Files" dialog on the maintenance page,
  reusing the existing upload/serve infrastructure (`createUploadedDocument` + signed
  `/api/files` URLs); audited, gated by `maintenance.manage`.
- Still pending (small): recording a status transition on an update; attaching files to a
  specific update rather than the job.

## E. Settings: DB-overridable storage & branding ✅ built

- ✅ **Done** — non-secret storage config (provider + S3 bucket/region/endpoint/path-style) is now
  DB-overridable on `AppSettings`, mirroring the SMS DB-over-env pattern.
  [`lib/services/storage-config.ts`](../lib/services/storage-config.ts) (`resolveStorageConfig`)
  merges DB over env; `getFileStorage()` is async and memoizes the constructed provider by a
  non-secret config signature, so a Settings change rebuilds it on the next request (no redeploy).
  The `S3FileStorage` constructor takes the resolved config (each field falls back to env). An
  editable form sits under the existing storage status panel (Settings → Organization), and the
  panel shows the **effective** config + its source (Settings vs environment).
- **Safe-by-default:** with no DB override the resolver returns exactly the env values, so existing
  deployments are byte-identical. **Secrets stay in env** (`S3_ACCESS_KEY_ID` /
  `S3_SECRET_ACCESS_KEY` / `STORAGE_ENC_KEY`) and are never written to or read from the DB; the
  **local dir** (`LOCAL_STORAGE_DIR`) and **encrypt flag** (`STORAGE_ENCRYPT`) also stay env-only
  since the local dir is woven into the `/api/files` signing path.
- Still pending (optional): DB-overridable local dir / encrypt would require threading the dir into
  the file-serving signature helpers; left env-only on purpose.

## F. Performance backlog (from the audit)

These are safe, isolated follow-ups to the 4.5 batching work:

- ✅ **Done** — `batchLeaseAccounting()` (2 queries for N leases) now backs the **reminder worker**
  sweeps (`lib/services/reminders.ts` bulk-overdue + scheduled loops), removing the per-lease N+1;
  `batchLeaseSnapshots` shares the same helper.
- ✅ **Done** — composite `Reminder(tenantId, createdAt)` index (the prefix still serves the plain
  `tenantId` lookup; idempotency is already a raw-SQL partial unique on
  `(leaseId, tenantId, reminderType, periodKey)`).
- Still pending: `select` down the heavy report/income queries (`getTenantLedger`,
  `getIncomeSummary`); parallelize reminder sends within provider rate limits; single-pass
  dashboard unit-occupancy aggregation; `select` names-only on recent payments.

## G. Security backlog

- Re-run `/security-review` on each portal/payment PR (new external surfaces).
- ✅ **Done** — break-glass passphrase entropy bumped to 256 bits (`randomToken(32)`).
- Consider per-resource ownership checks once multi-tenant data isolation (org_id) is on the
  table.

## H. Deeper settings-driven customization

A pass to push hard-coded look-and-feel and behavioural constants into the Settings hub, so an
operator can re-skin and re-tune the deployment without a code change. Each item already has a
single static source of truth; the work is to add a (non-secret) `AppSettings` field, thread a
resolved value through, and expose it in the relevant Settings page — reusing the established
patterns (DB-over-env, `withAudit` mutations, capability-gated pages, defaults living in a pure
module). Items are independent and individually shippable. **Invariants are untouched:** money
still flows through `lib/money.ts`, the ledger stays the source of truth, and any value feeding
the accounting core stays in a clock-injected, unit-tested pure module.

### H1. Branding & theme (Settings → Organization)
- ✅ **Done — brand / accent colour.** `AppSettings.brandColor` (a hex) re-tints the app shell.
  The pure [`lib/config/brand.ts`](../lib/config/brand.ts) takes only the colour's **OKLCH hue**
  (`hexToOklchHue`) and re-emits `--primary`/`--ring` (+ sidebar twins) with each variable's
  *shipped* lightness/chroma — so light/dark contrast and the print-forces-light rule are
  preserved automatically (only the tint changes; greys are rejected). A `<BrandColorStyle>`
  server component injects the override into the staff app + tenant/payer portal shells; blank →
  the shipped theme. Unit-tested (`lib/config/brand.test.ts`).
- Still pending: **letter-tile fallback colour** for the favicon/avatar in
  [`app/icon.tsx`](../app/icon.tsx) — fold into the same brand colour. Public `/apply` + `/login`
  could also pick up the override (they aren't under the three branded layouts).

### H2. Display & locale (Settings → Organization)
- **Currency / number / date locale.** [`lib/money.ts`](../lib/money.ts) `formatCurrency` defaults
  `locale = "en-US"` and dates render with a fixed format; surface an org locale so `Intl`
  formatting follows it. **Display only** — never the cents math.
- ✅ **Done — default table page size.** `AppSettings.defaultTablePageSize` (Settings →
  Organization) sets the initial `DataTable` page size app-wide. Options live in the pure
  `lib/config/table.ts` (`sanitizeTablePageSize` clamps to 10/20/50); the value is supplied once via
  a `TablePageSizeProvider` mounted in the app shell, so no page threads it and a per-table
  `defaultPageSize` prop still wins. Locale (currency/number/date) is still pending — it needs
  `formatCurrency`/date threading across many call sites.

### H3. Documents & numbering
- ✅ **Done — receipt number prefix.** `AppSettings.receiptPrefix` (Settings → Organization) drives
  the `<PREFIX>-YYYYMMDD-NNNN` number; the pure `lib/accounting/receipts.ts` takes a prefix +
  `sanitizeReceiptPrefix` (A–Z/0–9, max 8), sequence parsing is prefix-scoped, and existing
  receipt numbers are never disturbed.
- ✅ **Done — report/receipt header text.** `AppSettings.reportHeaderText` (Settings → Organization)
  is free-text printed atop the Reports page and each receipt (e.g. a "remit to" block), blank →
  nothing, same free-text + audit pattern as the footer.

### H4. Notifications content & timing (Settings → Messaging / Notifications)
- ✅ **Done — email subjects.** Per-type email **subject** overrides
  (`AppSettings.emailSubjects`, merged over `DEFAULT_EMAIL_SUBJECTS`) editable at Settings →
  Messaging → Email, consumed by the email reminder path. Bodies reuse the existing (overridable)
  `smsTemplates`, so the email channel from workstream **C** is now fully operator-customizable
  without a separate body store.
- Still pending (small): a separate email **body** store distinct from the SMS template (today
  both channels share the body text).
- ✅ **Done — reminder send hour.** `AppSettings.reminderSendHour` (Settings → Messaging) sets the
  hour the worker runs its daily reminder + digest sweeps. The pure `lib/reminders/schedule.ts`
  (`reminderCron`) resolves DB-over-env: a saved hour → `0 H * * *`, else `REMINDER_CRON`, else
  09:00; read once at worker startup. `STAFF_DIGEST_CRON` (the weekly Monday digest) stays env-only.

### H5. Tenant-facing copy (Settings → Organization)
- ✅ **Done** — `AppSettings.portalWelcomeText` (tenant portal home) and `AppSettings.applyIntroText`
  (public `/apply` form) are editable branded free-text (`whitespace-pre-wrap`), blank → shipped
  default, same shape as the hosted privacy/terms text.
- ✅ **Done — portal "how to pay" + apply confirmation.** `AppSettings.portalPaymentHelpText`
  (a tenant-portal "How to pay" card) and `AppSettings.applyConfirmationText` (the public `/apply`
  post-submit message) are editable branded free-text, blank → hidden / shipped default.

### H6. Status & terminology labels (stretch)
- **Status badge labels** (and optionally colours) and a few domain nouns ("Rent", "Tenant") are
  hard-coded. A small label-override map would let an operator match their own vocabulary. Keep the
  underlying enum values fixed — override the *display* only.

### H7. Configurable aging buckets (careful — touches the accounting core)
- The aging report thresholds (current / 1–30 / 31–60 / 61–90 / 90+) are fixed in
  `agingFromOpenCharges` ([`lib/accounting/`](../lib/accounting/)). These *could* be operator-tuned,
  but because they live in the pure, unit-tested accounting core, the bucket bounds must be passed
  **in** as injected config (never read from the DB inside the pure module) and covered by new
  tests. Lowest priority; flagged here so it's a deliberate decision, not an accidental one.

### H8. Custom application questions ✅ built
- ✅ **Done** — beyond the fixed `APPLICATION_FIELDS`, operators can define their own **question
  sections** at Settings → Applications, with types **short text / paragraph / yes-no checkbox /
  single choice / checkbox list (multi-select)** (e.g. a "Pets" section: a yes/no plus a checkbox
  list of animals). Config lives in `AppSettings.applicationCustomSections`; the pure
  [`lib/applications/custom-questions.ts`](../lib/applications/custom-questions.ts)
  (`resolveCustomSections` / `validateCustomAnswers` / `buildAnswerSnapshot`) sanitizes the
  untrusted JSON and validates submissions; answers are stored as a history-proof
  `RentalApplication.customAnswers` snapshot and shown on the staff review page. 10 unit tests.
- Still pending (small): drag-reorder of sections/questions, and attaching the answers into the
  background-check / tenant-conversion flows.

**Acceptance (per item):** the setting changes the rendered/behavioural value live (no redeploy),
the change is audited, non-secret values only, and the shipped default is unchanged when the field
is empty. Anything feeding accounting/period/money logic is threaded as injected config into the
pure modules with unit tests — the DB layer never re-implements it.

---

### Suggested order

A and B are the high-value foundation (and B's ledger integration is low-risk because it reuses
the payment service). C and D layer on once A exists. E, F, G are independent and can slot in
between as smaller PRs. **H** is a backlog of small, independent customization PRs — most are
low-risk free-text/preference fields that can be picked up any time (H4's email templates pair
with C; H7 is last because it touches the accounting core). Keep each workstream to its own PR
with tests + a Playwright check, the way 4.5 was shipped.
