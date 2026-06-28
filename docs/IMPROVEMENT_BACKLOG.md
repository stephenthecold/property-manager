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
(ask first + blast radius before building) · ✅ = shipped (PR #).

---

## 🔁 Refresh — 2026-06-28 (after #117–#128 shipped)

Re-audited grounded in the real files. **The prior list materially UNDERSTATED what's already
built** — three "deferred/missing" items are in fact shipped (verified against the code):

- **Online card payments via Stripe are built and production-capable**, not "pending a gateway."
  `lib/providers/payment/stripe.ts` `createCheckout` POSTs real Checkout Sessions to
  `api.stripe.com`; `startCheckout` (`lib/services/gateway-checkout.ts:28`) dispatches to the
  gateway selected by `PAYMENT_GATEWAY` (`stub` default, `stripe` real), and the portal "Pay now"
  redirects to whatever URL it returns. Webhooks are HMAC-verified and post to the ledger
  idempotently (`app/api/payments/webhook`). The stub is only the dev default. *(An audit agent
  claimed the portal "Pay now" is hardcoded to the stub — that was wrong; it dispatches to the
  configured provider.)* What's actually missing is **recurring autopay**, **failed-payment
  visibility**, and reading the **payment-method preference**.
- **A lightweight leasing funnel exists** — public `/apply` + staff `/applications` with
  operator-defined custom questions and a background-check provider seam (`lib/providers/
  background-check/`, stub), plus a public site (`/welcome`, `lib/services/public-site.ts`) that
  lists vacant/upcoming units (`listPublicAvailability`). The *full enterprise* funnel
  (syndication, screening-provider, application fees) stays deferred; the small slice is shipped.
- **A payer portal** (`app/payer-portal`, `lib/payer-portal/session.ts`) for third-party/subsidy
  (HUD/Section 8) payers exists as its own auth lane — barely mentioned before.
- **Prorate-first-period is exposed at lease create** (`app/(app)/leases/new/lease-form.tsx`,
  defaulted on) — previously listed as a gap. Down to a label-clarity polish only.

---

## ✅ Built — don't rebuild

Optional modules (Settings → Modules; `AppSettings.modules`): **financials, maintenance,
tenantPortal, applications, payerPortal, inspections, publicSite, portalLedgerExport**.

- **Money/ledger core** — integer-cent ledger as source of truth, FIFO allocation, reversals,
  idempotent charge/late-fee generation, deposit→ledger move-out + damage chargeback (#123).
- **Leasing** — templates + e-sign (multi-signer, landlord-applied), renewals (extend/successor,
  portal + dashboard, #117–120), **amendments/addenda** (#128), lease abstract (#85), co-tenants,
  prorate-on-move-in, lease-expiration alerts + weekly digest + window (#81/#122).
- **Payments** — gateway seam with **real Stripe** + stub, HMAC webhooks → idempotent ledger,
  digital receipts, payer attribution.
- **Maintenance & inspections** — work-order lifecycle + assignee + SLA (#77), preventive-maint log
  (#79), asset/warranty registry (#80), vendors, turnover/make-ready (#124), inspection templates +
  per-item photos + printable report (#125), unified inspection items (#126).
- **Comms** — two-way SMS inbox (#75), SMS+email reminders with delivery tracking (#86), consent
  audit (STOP/START), inbound email, per-tenant activity timeline (#73/#78), staff digests.
- **Portal** — tenant portal (balance/ledger/receipts/documents, notices #82, maintenance requests +
  photos #71, renewal acceptance #119, ledger CSV + filters #121), payer portal.
- **Reporting** — 8 CSV report types (`/api/reports/[type]`), audit-log CSV (#83), per-property
  financials/P&L, vacancy outlook, dashboard stat cards.
- **Platform** — capability/RBAC matrix (Settings → Permissions), break-glass, OIDC, ⌘K search
  (#74), in-list DataTable search + history-aware back-links (#127), mobile nav, two themes.

> **Live-DB verification debt (still open).** Most PRs cleared types+tests+lint+review but were not
> all exercised against a live DB/browser in the build env. The amendment (#128) and deposit (#123)
> flows WERE render-verified against a seeded Postgres this session; the older migrations
> (#79/#80/#86) and worker schedules still want a one-time `prisma:deploy` + `/verify` pass.

---

## Focus areas — what's left (deduplicated, prioritized)

### 1. Collect rent online for real — payments (🔥 payments hot zone)
The Stripe rails exist; the value is finishing the loop and the recurring case.
- `[POLISH] V:H E:S` — **Use the payment-method preference** — `Tenant.preferredPaymentMethod` is
  captured but never read; hint/default it on portal Pay-now + staff record-payment. *(cheap, real)*
- `[GAP] V:M E:M 🔥` — **Failed-payment / webhook visibility** — webhook failures are silent; add a
  `PaymentWebhookAttempt` log + a staff "failed gateway payments" view. `app/api/payments/webhook`.
- `[GAP] V:H E:L 🔥` — **In-portal autopay (recurring)** — saved method → auto-charge on the due
  date; builds on the Stripe adapter (Checkout in `setup`/subscription mode) + the idempotent
  webhook→ledger path. Needs a careful consent/idempotency pass. `lib/providers/payment/stripe.ts`.
- `[GAP] V:M E:M` — **Payer-portal Pay-now** — the payer portal is read-only; let subsidy payers
  self-pay via the same gateway seam. `app/payer-portal/` + extend `startCheckout`.

### 2. Owner-operator tax & money clarity — accounting
Highest non-payment ROI for a solo landlord at tax time.
- `[GAP] V:H E:M 🔥` — **Owner draws/withdrawals** — log personal draws/reimbursements against a
  property; Financials shows net "before vs after draws." New table + `ownerDraws` flag; audited.
- `[GAP] V:M E:M` — **Schedule-E / tax-summary export** — per-property gross rent, expenses by
  category, mortgage interest, depreciation (from `Property.purchaseDate` + cost) → PDF/CSV.
- `[GAP] V:M E:M` — **Mortgage amortization schedule** — principal/interest from existing Property
  financing fields; pure `lib/accounting/mortgage.ts`, read-only view under `/financials`.
- `[GAP] V:M E:L 🔥` — Bank-reconciliation stub (CSV match payments/expenses) — *heavier; defer.*

### 3. Own-LLC separation — portfolio (the small slice; manage-for-owners stays deferred)
- `[POLISH] V:M E:S` — **Property entity/LLC tag** — optional `Property.legalEntityName`; surface on
  Properties + Financials rows. `prisma/schema.prisma` Property block.
- `[GAP] V:M E:M` — **Per-entity rollup** — group expected/collected/net by entity on Financials +
  an income report with an entity column. `lib/services/financials.ts`, `lib/services/reports.ts`.

### 4. Fill vacancies faster — leasing funnel (no hot zone; reuses shipped seams)
- `[GAP] V:H E:M` — **Public vacancy-browse page** (`/vacancies`) — searchable unit gallery
  (beds/rent/availability) with apply CTA, distinct from the `/welcome` splash. Reuses
  `listPublicAvailability()` — no schema change.
- `[POLISH] V:M E:S` — **Application confirmation email** + a **dashboard applications widget**
  (submitted/reviewing count) mirroring the expirations card. Reuses the email provider seam.

### 5. Numbers a landlord actually uses — reporting
- `[GAP] V:M E:M` — **PDF/Excel export + scheduled email delivery** of existing reports (tax prep,
  bank/accountant). Pairs with the Schedule-E export (§2). `lib/services/reports.ts` + worker.
- `[POLISH] V:M E:S` — **Period-over-period / YoY** on the income summary.
- `[POLISH] V:M E:S` — **Occupancy/turnover KPIs + vacant-days & lost-rent** on the dashboard
  (`getVacancyOutlook` + `DepositDisposition`/`PropertyExpense`).
- `[POLISH] V:M E:M 🔥` — **Saved filters / named views** (small `SavedFilter` table) for the
  repeated Leases/Reports filters.

### 6. Comms hardening & cohesion
- `[GAP] V:H E:L` — **Email bounce + auto-suppression** — SMTP has no bounce handling; undeliverable
  addresses linger forever. Add a bounce webhook + `Tenant.emailDeliveryStatus` (mirror SMS #86).
- `[COHESION] V:M E:S` — **Consolidated message center** — unify SMS inbox + email inbox + notices
  into one filtered view. `app/(app)/inbox/`.
- `[POLISH] V:M E:S` — **Per-event reminder preferences** + tenant-portal **self-service
  channel/consent toggles** (SMS vs email). `lib/reminders/channel.ts`.
- `[POLISH] V:M E:M` — Recipient segmentation/preview on bulk sends.

### 7. Resident-experience polish — portal
- `[POLISH] V:M E:S 🔥` — **Tenant account page** — edit contact, change password, channel/consent
  prefs, login history; consolidates today's scattered home-page toggles. *(portal auth lane)*
- `[COHESION] V:M E:S` — **Unified portal nav** + document type-filter/search + maintenance-request
  **status timeline** (staff replies visible to the tenant).

### 8. Maintenance & asset cohesion
- `[GAP] V:M E:M` — **Asset warranty alerts** — warranty dates exist but no expiring/expired view or
  dashboard widget. `lib/maintenance/warranty.ts` + `/assets` list.
- `[GAP] V:M E:M` — **Maintenance cost rollup/forecast** per property/asset by period.
- `[POLISH] V:M E:S` — Maintenance-job **CSV export** + tags/search (parity with other lists).

### 9. Platform & security (hot zone — ask first)
- `[GAP] V:M E:L 🔥` — **Staff 2FA/TOTP** — the right *security* item once any OIDC staff login
  exists, but lower *operator ROI* than onboarding (per the platform agent); needs ask-first +
  blast-radius. `auth.ts` JWT callback, `lib/auth/session.ts`, `User.totpSecret`.
- `[POLISH] V:M E:S` — **Per-user session/login history** (lighter security win; `UserSession` table).
- `[GAP] V:M E:M` — **CSV import + onboarding wizard** — day-1 bulk load (properties/units/leases/
  tenants); rated a high day-1 unlock. No ledger touch.

### 10. Leasing follow-ups (smaller)
- `[COHESION] V:M E:S` — **Lease abstract enrichment** — show renewal status, signed amendments, and
  finalized move-out disposition (all already in the DB). `app/(app)/leases/[id]/abstract/`.
- `[GAP] V:M E:M 🔥` — **Guarantor/co-signer** (distinct from co-tenant) — signs the lease, on the
  abstract, not ledger-touched. Schema + e-sign signer path.
- `[GAP] V:M E:L` — Bulk lease actions (renewal offers / rent increases across expiring leases).
- `[POLISH] V:L E:S` — Prorate label clarity (the flag is built; just clarify the off-state copy).

---

## Deferred initiatives (deliberate — don't re-litigate without a new decision)

- **A. Owner / portfolio layer for THIRD-PARTY owners** (owner statements/portal, distributions,
  multi-entity trust accounting) — deferred: operator runs their own properties. *(The own-LLC
  rollup in §3 is the in-scope slice.)*
- **B. Deep accounting** (full GL, A/P + bill pay, bank rec, accrual P&L, budget-vs-actual) —
  enterprise bookkeeping. *(Exceptions in scope: deposit→ledger #123, owner draws + Schedule-E §2.)*
- **C. Collections/ACH depth** (programmatic ACH orchestration, NSF/returns, payment plans, fee
  pass-through, delinquency workflow) — not selected. *(In-portal autopay §1 is in scope and rides
  the existing Stripe rails; NSF only becomes ROI-positive at higher ACH volume.)*
- **F. Full leasing funnel** (syndication/listings to Zillow/Apartments.com, ATS/lead scoring,
  real screening provider, application fees) — deferred. *(The `/vacancies` page + confirmation
  email in §4 is the in-scope slice on top of the shipped `/apply` + public site.)*
- Trigger→action **workflow engine**, public **REST API + keys**, vendor portal + dispatch, PWA —
  enterprise-heavy for a solo operator; revisit on a specific ask.

---

## Next up — recommended order

Grounded in small-operator ROI, with hot zones flagged for ask-first:

1. **Finish online payments** (§1) — read the payment-method preference *(quick win)*, then
   failed-payment visibility, then **autopay** 🔥. Highest ROI: real rent collection.
2. **Tax clarity** (§2) — owner draws 🔥 + Schedule-E export + mortgage amortization. Pairs with the
   reporting **PDF export** (§5).
3. **Own-LLC separation** (§3) — entity tag + per-entity rollup.
4. **Clean, parallelizable batch (no hot zone):** public **`/vacancies`** page (§4),
   **email bounce suppression** (§6), **lease abstract enrichment** (§10), maintenance **CSV
   export/warranty alerts** (§8). Good for parallel worktree agents.
5. **Reporting depth** (§5) and **portal account page** (§7).
6. **Hot zones, on explicit go-ahead:** Staff **2FA/TOTP** (§9), autopay (§1).

Build each with `/feature-intake`; refresh this file with `/competitive-audit` as the app evolves.
