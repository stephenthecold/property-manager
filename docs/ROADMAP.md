# Roadmap

Phases 1–4.7 are built and deployed. Phase 5 items attach to the same seams
(`sourceType/sourceId`, provider interfaces, `AuditLog`, the capability layer) without
reshaping the schema — see [PHASE5_PLAN.md](./PHASE5_PLAN.md).

## Phase 1 — Core admin app ✅ (built)

Auth (Authentik OIDC + break-glass + installer), properties/buildings/units, tenants, leases,
ledger-based payments with strict FIFO allocation, void/reversal, idempotent billing worker
(rent charges + late fees), dashboard, rent-roll/overdue reports + CSV, audit trail, seed data,
accounting unit tests, Docker Compose stack.

## Phase 2 — Receipts & uploads ✅ (built)

- **Digital receipts** — auto-created for every posted payment (`ensureReceiptForPayment`,
  idempotent via a partial unique on `paymentId WHERE receiptType='digital'`); numbers
  `RCT-YYYYMMDD-NNNN` sequence per property-tz day; printable receipt page (`/receipts/[id]`,
  print CSS) with balance-after-payment pinned to the payment's ledger position; mark-sent
  (sms/email/printed) with audit.
- **Uploads** — `POST /api/uploads` (camera-friendly dialog, 15 MB cap, type allowlist),
  documents list/detail pages, attach to tenant/payment/receipt, "create payment from
  document" review form. Storage providers: `local` (HMAC-signed URLs served by
  `/api/files`), `s3` (AWS/R2/B2/MinIO), `stub`.
- **OCR scaffold** — `OcrProvider` interface + stub (`lib/providers/ocr/`), gated by
  `OCR_ENABLED`; extracted text feeds a pure suggestion parser (amount/date/reference) that
  prefills the review form. A real provider plugs into `getOcrProvider()`.

## Phase 3 — SMS reminders ✅ (built)

- Twilio provider implemented (REST via fetch, no SDK); stub remains the default.
- Template rendering (`lib/reminders/templates.ts`) with per-type default bodies; manual
  sends from the tenant page with live preview; **bulk "SMS all overdue"** on Reports.
- Scheduled worker job (`REMINDER_CRON`, default 09:00): due-soon (`REMINDER_DUE_SOON_DAYS`
  ahead, no charge row required) + one overdue reminder per open charge past grace —
  idempotent via partial unique `(leaseId, reminderType, periodKey)`, with failed/stranded
  rows retried on later sweeps.
- Delivery-status webhook `/api/sms/status` (public; processed only with a verified
  X-Twilio-Signature — ignored entirely under other providers).
- **Consent is absolute**: no consent or no phone → no row, no send, manual or automated.

## Phase 4 — Reporting & polish ✅ (built)

Income summary (cash basis, property-tz month buckets, reversal netting), lease expirations,
payments-by-method, tenant/unit ledger CSVs (unit ledger resets the running balance per lease),
report filters (property/date range/window), list search & filters (tenants/payments/leases),
and the read-only **audit-log viewer** (`/audit`, admin+). Printable pages stand in for PDF
generation (no headless-browser dependency); CSV cells are formula-injection-guarded.

Also: a **Settings hub** (audited) — Organization (white-label name/logo/receipt footer,
default tz/currency, **read-only file-storage status panel**) and Messaging (SMS provider with
the Twilio auth token AES-GCM-encrypted at rest, scheduled-reminder toggles and due-soon
window, per-type SMS template overrides, test send). DB config wins over env, mirroring
AuthSettings.

## Phase 4.5 — UX, RBAC, performance & security pass ✅ (built)

- **Tables**: a reusable sortable + paginated `DataTable` (10/20/50 page sizes) across every
  list; responsive layout from mobile to ultra-wide; colour accents on dashboard stats/tables.
- **Forms**: add/edit flows moved into pop-out dialogs (`FormDialog`) with the saved values
  shown on the page; property units shown as a per-building tier list; deposits managed on the
  lease (non-refundable is a toggle) with a Deposits column on the Leases page.
- **Role permissions**: an editable capability matrix (`lib/auth/permissions.ts`,
  Settings → Permissions) layered over the role hierarchy — `requireCapability` /
  `authorizeApiCapability` enforce it; defaults reproduce the old behaviour.
- **Performance**: `batchLeaseSnapshots()` collapses the dashboard/report/tenant-list N+1 into
  two queries; parallelized reads; composite indexes on `LedgerEntry`/`Payment`.
- **Security**: capability-gated report-export API (closed a ledger-enumeration IDOR) and
  document detail; `windowDays` clamp; sanitized webhook logging.

## Phase 4.6 — Modules: Financials & Maintenance ✅ (built)

- **Module system**: optional features toggled at Settings → Modules
  (`AppSettings.modules`; disabling hides UI, data is always retained). Defaults:
  Financials on, Maintenance off.
- **Financials module** (`financials.view`/`financials.manage` capabilities, finance+ by
  default): `PropertyExpense` log (utilities/insurance/maintenance/taxes/other, attributable
  to property/building/unit/lease), property mortgage terms (monthly payment + maturity) with
  payoff projections, per-property net income (`/financials`), and profit cards on the
  dashboard. Confidential dashboard totals (expected/collected) are now gated by
  `financials.view`.
- **Maintenance module** (`maintenance.manage`, manager+ by default): per-unit job tracker
  (pending/completed; a completion cost auto-logs a maintenance expense via
  `sourceType="maintenance_job"`), recurring monthly tasks per property (done-this-month in
  the property tz), open-jobs panel on the unit page.
- **Quick collect**: per-row Collect button on the dashboard tenant table (prefilled with the
  outstanding balance, falling back to the monthly charge).
- **Encrypted file storage**: `STORAGE_ENCRYPT=true` wraps the local provider with AES-256-GCM
  at rest (network-share friendly; key from `STORAGE_ENC_KEY` or derived from
  `SETTINGS_ENC_KEY`); plaintext files from before stay readable. See DEPLOYMENT.md.
- **Parcel-level fields**: monthly mortgage + maturity date and the purchase date were moved
  from `Building` to `Property` (data-preserving migrations: payments summed / earliest date).

## Phase 4.7 — Theming & branding ✅ (built)

- **Two gradient themes** with a header light/dark toggle (next-themes, persisted per
  browser): "Slate & Sky" (cool blue-gray light) and "Navy Night" (deep navy dark). CSS
  variables in `app/globals.css`; print media always forces light so receipts/reports never
  print light-on-paper.
- **Full control re-skin**: inputs/textareas/native selects get solid themed surfaces via the
  components + a base-layer rule (no `bg-transparent` bleed-through); bare tables sit on card
  surfaces; all tinted badges carry `dark:` variants; the Organization/Auth/Messaging settings
  forms are carded. Verified with a 45-screenshot both-themes sweep.
- **Branding**: the uploaded business logo shows in the app banner and as a dynamic favicon
  (`app/icon.tsx`, logo or letter-tile fallback; `favicon.ico` legacy fallback).

## Phase 4.75 — Settings hardening & outbound email ✅ (built)

- **Durable local uploads**: compose mounts an `uploads` named volume at `/data/uploads` on
  app + worker and defaults `STORAGE_PROVIDER=local`; the storage status panel warns when the
  directory sits on the container's writable layer (lost on rebuild).
- **Inline settings errors**: billing defaults moved to `useActionState` returned-state (no
  more production digest page on validation); users-page guards redirect back with a banner.
- **Telnyx SMS provider** (env or DB config; API key in the encrypted token fields) joins
  stub/Twilio.
- **Outbound email**: SMTP provider with password or OAuth2/XOAUTH2 auth (Gmail default token
  endpoint, Microsoft 365 via custom token URL), DB-only config with AES-GCM-encrypted
  secrets, stub provider, test send, and one-click "email receipt to tenant" (marks
  sent-via-email, audited). The email *reminder* channel (consent model + per-channel
  idempotency slots) stays in Phase 5.

## Phase 5 — In progress

See [PHASE5_PLAN.md](./PHASE5_PLAN.md) for the workstream plan and live status. All attach to
existing seams (`sourceType/sourceId`, provider interfaces, `AuditLog`, the capability layer).

**Shipped so far (beyond the 4.x line above):**

- **Tenant portal** (workstream A) — local auth lane (`/portal` + `/api/portal`, hashed cookie
  tokens), tenant-scoped balance/ledger/receipts/documents, invite + SMS-code sign-in, and staff
  **impersonation / trial-login** (Settings → Impersonate).
- **Rental applications** module — public `/apply` intake with an operator-configurable form
  (Settings → Applications), staff review/edit, one-click convert/deny, and a **background-check**
  provider seam + stub + screening UI (`applications.manage`).
- **Built-in e-signing** for lease agreements and renewals (saved landlord signature, drawn/typed
  initials; `esign.manage`).
- **SMS opt-in/out** (STOP/START/HELP webhook + portal toggle) and **10DLC / A2P compliance**
  (hosted privacy/terms pages, settings card, portal footer).
- **Dashboard customization** — per-user add/remove/reorder of stat bubbles and sections (edit
  mode + hidden tray); **vacancy outlook**; unit **occupancy/serviceability** reconcile.
- **Outbound email** (SMTP, receipt-by-email), **Cash App** payment tag, void-from-Payments,
  waive rent/late-fees, request links from the request host, weekly staff overdue digest.
- **Email reminder channel** (workstream C) — reminders now send by SMS *or* email per a
  per-tenant channel preference, with absolute per-channel consent (reuses the SMTP provider +
  template renderer).
- **Maintenance tickets** (workstream D, core) — job **priority** + a threaded, audited
  **update/progress log**.
- **Custom application questions** (workstream H8) — operators define their own question
  **sections** on the public `/apply` form (short text / paragraph / yes-no / single choice /
  checkbox list), e.g. a "Pets" section; answers are validated, snapshotted on the application,
  and shown to staff.
- **Compliant SMS opt-in workflow** — a public no-login opt-in page (`/sms-opt-in`) with the full,
  separate, un-prechecked consent language; an optional opt-in checkbox on the rental application;
  an append-only `SmsConsentRecord` audit log (phone, status, timestamp, source, exact consent
  text/version, IP, user agent); an admin SMS-consent view filterable by status (opted in / not
  opted in / opted out / missing mobile); email + printable-letter opt-in invitations (never SMS);
  exact STOP/HELP inbound replies; and a shipped default privacy policy with the required
  mobile/SMS data-sharing restriction. Outbound SMS stays gated on `smsConsent` + a valid number.
- **Online-payment gateway seam** (workstream B) — a `PaymentGateway` interface + deterministic
  stub + signature-verified `POST /api/payments/webhook` that posts a verified event through the
  existing payment service (idempotent; no new balance math). A real adapter (+ portal "Pay now")
  is the remaining production step.
- **DB-overridable storage config** (workstream E) — provider + non-secret S3 params
  (bucket/region/endpoint/path-style) editable at Settings → Organization (DB-over-env), taking
  effect without a redeploy; secrets, the local dir, and the encrypt flag stay env-only.
- **Backlog**: reminder-worker accounting batching + `Reminder(tenantId, createdAt)` index (F),
  256-bit break-glass (G), and settings-driven **receipt prefix** + **portal/apply copy** (H).

**Still pending:** a real payment adapter + portal "Pay now" (B production step), the remaining
F/H niceties (default page size/locale, status-label overrides, configurable aging buckets,
report query `select`-narrowing), and the `org_id` multi-tenant isolation (G).

## Known simplifications (documented defaults)

- One currency per property (column exists for multi-currency later).
- One late fee assessment per period (daily-accrual and one-time supported; no compounding).
- Single organization per deployment (no `organization_id`).
