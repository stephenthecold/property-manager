# Roadmap

Phases 1–4 are built and runnable. Phase 5 items attach to the same seams
(`sourceType/sourceId`, provider interfaces, `AuditLog`) without reshaping the schema.

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
  to property/building/unit/lease), building mortgage terms (monthly payment + maturity) with
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

## Phase 5 — Next large phase

See [PHASE5_PLAN.md](./PHASE5_PLAN.md) for the actionable plan. Headline workstreams: tenant
portal + online payments (ACH/card), email channel, maintenance tickets, DB-overridable
storage/branding, and the remaining batch-load/perf items from the audit. All attach to
existing seams (`sourceType/sourceId`, provider interfaces, `AuditLog`, the capability layer).

## Known simplifications (documented defaults)

- One currency per property (column exists for multi-currency later).
- One late fee assessment per period (daily-accrual and one-time supported; no compounding).
- Single organization per deployment (no `organization_id`).
