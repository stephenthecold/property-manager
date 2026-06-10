# Roadmap

Phase 1 (this build) is complete and runnable. Later phases attach to groundwork that already
exists, so they add UI/integration rather than reshaping the schema.

## Phase 1 — Core admin app ✅ (built)

Auth (Authentik OIDC + break-glass + installer), properties/buildings/units, tenants, leases,
ledger-based payments with strict FIFO allocation, void/reversal, idempotent billing worker
(rent charges + late fees), dashboard, rent-roll/overdue reports + CSV, audit trail, seed data,
accounting unit tests, Docker Compose stack.

## Phase 2 — Receipts & uploads

| Feature | Groundwork already present | Remaining work |
|---|---|---|
| Digital receipts | `Receipt` model; `LedgerEntry.sourceType/sourceId`; payment→entry link | Receipt-number generator (`RCT-YYYYMMDD-NNNN`), PDF/printable page, send-by-email/SMS |
| Paper receipt photo upload | `UploadedDocument` model; `FileStorage` interface + S3 impl; MinIO compose profile; presigned-upload method | Mobile camera upload flow, attach to tenant/payment/receipt, "create payment from upload" review screen |
| Optional OCR | `ocrText` / `ocrConfidence` columns; `OCR_*` env | OCR provider integration, human-confirm-before-post UI |

## Phase 3 — SMS reminders

| Feature | Groundwork | Remaining |
|---|---|---|
| Manual + bulk reminders | `SmsProvider` interface + stub; `Reminder` model; `smsConsent` field; templates concept | Twilio/Telnyx impl, template variable rendering, bulk-overdue action, scheduled reminders, delivery-status webhook |
| Consent enforcement | `Tenant.smsConsent` | Block automated sends without consent (enforced in the reminder service) |

## Phase 4 — Reporting & polish

PDF reports, more report types (tenant/unit ledger, income summaries, lease-expiration,
payment-method summary), richer filters/search, and an **audit-log viewer** (read-only UI over
the existing append-only `AuditLog`).

## Phase 5 — Optional enhancements

Tenant portal, online payments (ACH/card), email reminders, maintenance tickets, lease
templates/e-sign, QuickBooks export, bank-transaction import.

## Known Phase-1 simplifications (documented defaults)

- One currency per property (column exists for multi-currency later).
- No mid-period proration (full-period rent).
- One late fee per period (no compounding).
- Single organization per deployment (no `organization_id`).
