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

Also: a **Settings hub** (owner-only, audited) — Organization (white-label name/logo/receipt
footer, default tz/currency for new properties) and Messaging (SMS provider with the Twilio
auth token AES-GCM-encrypted at rest, scheduled-reminder toggles and due-soon window,
per-type SMS template overrides, test send). DB config wins over env, mirroring AuthSettings.

## Phase 5 — Optional enhancements

Tenant portal, online payments (ACH/card), email reminders, maintenance tickets, lease
templates/e-sign, QuickBooks export, bank-transaction import.

## Known Phase-1 simplifications (documented defaults)

- One currency per property (column exists for multi-currency later).
- No mid-period proration (full-period rent).
- One late fee per period (no compounding).
- Single organization per deployment (no `organization_id`).
