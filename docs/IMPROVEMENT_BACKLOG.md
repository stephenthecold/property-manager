# Improvement backlog — enterprise gap analysis

How this was produced: a **10-agent competitive audit** comparing this project to AppFolio,
Buildium, Yardi, DoorLoop, Propertyware, RealPage, and Entrata across ten domains. Regenerate or
refresh it anytime with the **`/competitive-audit`** skill; turn any item into a built change with
**`/feature-intake`**.

**Operator context that prioritizes this list** (from the intake interview):
- **Single-org, owner-operator** — runs their *own* properties (not managing for third-party owners).
- **Guiding lens: small-operator ROI** — build only what saves a self-managing landlord real time or
  money; skip enterprise-only complexity.

Tags: `[GAP|POLISH|COHESION]` · **V**alue H/M/L · **E**ffort S/M/L · 🔥 = touches a CLAUDE.md hot zone
(ask first + blast radius before building).

---

## Focus areas (chosen)

### D. Leasing lifecycle
- `[GAP] V:H E:S` — **Lease-expiration pipeline + alerts** — dashboard card + weekly digest 60 days
  out (`AppSettings.leaseExpirationAlertDays`). Seam: `lib/services/reminders.ts`, dashboard.
- `[GAP] V:H E:M` — **Renewal offer→acceptance** — staff mints an offer (new rent/term), tenant
  accepts + e-signs. New `LeaseRenewalOffer`; reuse e-sign token/signature path (`SigningRequest.kind`).
- `[COHESION] V:H E:M` — 🔥 **Deposit→ledger move-out statement** — itemize deductions, post refund or
  balance-owed as ledger entries (`sourceType="inspection_disposition"`). Touches `postPayment`/ledger.
- `[POLISH] V:M E:S` — **Lease abstract** — one-page printable summary from `AgreementContext`.
- `[GAP] V:M E:M` — **Amendments/addenda** — rider text + signature (`SigningRequest.kind="amendment"`).
- `[POLISH] V:M E:S` — **Prorate-first-period UI** — `Lease.prorateFirstPeriod` exists; expose at create.
- `[GAP] V:M E:L` — Guarantor/co-signer; bulk lease term actions.

### E. Resident portal
- `[GAP] V:H E:M` — **Maintenance-request photos** — tenant attaches ≤3 images from the portal; staff +
  tenant see them. Reuse `createUploadedDocument`; store ids on `TenantRequest`. *(First-batch quick win.)*
- `[GAP] V:M E:M` — **Notices inbox** — tenant-scoped `/portal/notices` over the existing `Notice` model;
  mark-viewed. 
- `[GAP] V:H E:M` — In-portal **autopay enrollment** *(depends on a real payment gateway — see C)*.
- `[GAP] V:H E:S` — **Renewal acceptance in portal** (pairs with D renewal flow).
- `[POLISH] V:M E:S` — Ledger date/type filters + tenant CSV download; payment-method hint on Pay-now.
- `[GAP] V:M E:L` — PWA/offline.

### G. Maintenance & ops
- `[GAP] V:H E:M` — **Work-order lifecycle + assignment + SLA** — status enum (draft/assigned/in_progress/
  on_hold/completed/canceled), `assignedTo`, due/overdue via pure `lib/maintenance/sla.ts`.
- `[POLISH] V:M E:M` — **Inspection templates + photos + report** — standardized move-in/out forms with
  photo capture and a printable report (`lib/inspections/templates.ts`, pure + tested).
- `[GAP] V:H E:M` — **Preventive-maintenance schedules with per-occurrence tracking** —
  `RecurringTaskExecution` (taskId, month, status); pure `lib/maintenance/schedules.ts`.
- `[POLISH] V:M E:S` — **Asset/equipment + warranty registry** — `Asset` (make/model/serial/warranty),
  optional `MaintenanceJob.assetId`.
- `[COHESION] V:M E:S` — 🔥 **Damage chargeback** from a move-out inspection item → ledger (with D).
- `[COHESION] V:M E:S` — Turnover/make-ready Kanban board; parts/inventory tags.
- `[GAP] V:H E:L` — Vendor portal + dispatch *(deferred — small operators usually text their contractor).*

### H. Comms & automation
- `[GAP] V:H E:M` — **Two-way SMS/email inbox** — capture inbound replies (extend `/api/sms/inbound`
  beyond STOP/START) into a per-tenant `InboundMessage` thread visible to staff.
- `[GAP] V:H E:S` — **Notification center / message log** — read-only unified view over existing
  `Reminder`/`Notice`/`AuditLog` rows (overlaps Initiative I's activity timeline).
- `[GAP] V:M E:M` — **Delivery/read + bounce tracking** — `deliveredAt`/`readAt`/`bounceReason` on
  `Reminder`/`Notice`; reuse `/api/sms/status`.
- `[POLISH] V:M E:S` — Per-event reminder preferences; bulk audience segmentation.
- `[GAP] V:M E:L` — Trigger→action **workflow engine** *(deferred — enterprise-heavy for a small operator).*

### I. Platform cohesion
- `[COHESION] V:H E:S–M` — **⌘K global search / command palette** across tenants/leases/properties/
  payments. New `lib/services/search.ts` + `app/api/search` (capability-gated) + client palette.
- `[COHESION] V:M E:M` — **Unified activity timeline** on detail pages — aggregate `AuditLog` +
  `Reminder` + payments + `TenantRequest` + `Notice` keyed by `sourceType/sourceId`. *(First-batch.)*
- `[GAP] V:L E:M` — **CSV import + onboarding wizard** — templated bulk load (properties/tenants/leases).
- `[GAP] V:M E:M` — 🔥 Staff **2FA/TOTP** (touches auth).
- `[POLISH] V:M E:S` — Saved filters/named views; report **PDF/Excel export** + scheduled delivery +
  period-over-period + occupancy/turnover KPIs; empty/loading/error + a11y polish.
- `[GAP] V:H E:L` — Public **REST API + keys** + integrations (QuickBooks/Plaid/Zillow) *(deferred).*

---

## Deferred initiatives (deliberate — don't re-litigate without a new decision)

- **A. Owner / portfolio layer** (owners entity, statements, distributions, management fees, owner
  portal, 1099s) — deferred: operator runs their *own* properties. Revisit if they start managing for
  third-party owners.
- **B. Accounting depth** (chart of accounts/GL, A/P + bill pay, bank reconciliation, accrual P&L,
  budget-vs-actual) — mostly enterprise-grade bookkeeping; deferred under the small-operator lens.
  *(Exception: the deposit→ledger bridge in D is in scope.)*
- **C. Payments & collections depth** (real ACH, NSF/returns, payment plans, convenience-fee
  pass-through, delinquency workflow) — not selected. *Note:* in-portal **autopay** (E) depends on a
  real payment gateway, so a Stripe card/ACH adapter is a prerequisite if autopay is pursued.
- **F. Leasing funnel** (public listings/syndication, applicant pipeline/ATS, screening, application
  fees, adverse-action) — not selected.

---

## Current build plan — "quick wins across bundles" first

The owner chose to knock out the smallest high-ROI slice of several bundles before deepening:

1. **Maintenance-request photos** (E) — tenant attaches photos; staff + tenant see them.
2. **Per-tenant/lease activity timeline** (I) — one feed of payments, reminders/notices, requests, lease
   events on the detail pages (also delivers the Messaging-hub "see all communication" need).
3. **⌘K global search** (I) — fast cross-entity find.

Then deepen: two-way inbox (H), work-order lifecycle (G), inspection photos (G). Move-out & renewals (D)
is queued but not in the first batch. Build each with `/feature-intake`; pause with a blast-radius
writeup before any 🔥 item.
