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

## 🔁 Refresh — 2026-06-28 (after #130–#136 shipped)

A large enterprise-gap batch (#130–#133) plus a full UI-consistency harden (#134–#136) shipped since
the last refresh. **Verified against the merged code** — the following items from the "what's left"
list are now built and have moved up into *Built — don't rebuild*:

- **Payments module — offline self-report → staff confirm** (#131, `lib/services/payments.ts`):
  a tenant reports a Cash App / cash / bank-transfer payment; it lands in a `/payments/pending`
  queue with **no ledger entry** until staff confirm (then it posts FIFO via the shared posting
  path). Hybrid methods + both logging paths (self-report and staff-direct). The captured
  **payment-method preference** is now read on the portal + tenant pages.
- **Portfolio module — own-LLC** (#130, `lib/accounting/portfolio.ts`): `Property.legalEntityName`
  tag + per-entity expected/collected/net rollup on Financials.
- **Public `/vacancies` browse page** (#130, `app/vacancies/`) under the publicSite module.
- **Reporting — PDF/Excel export + scheduled email delivery** (#130, `report-render.ts` +
  `report-schedules.ts`) and **dashboard operating KPIs + period-over-period/YoY** (#130,
  `lib/accounting/kpis.ts`).
- **Comms hardening** (#130): **email bounce webhook + auto-suppression**
  (`Tenant.emailDeliveryStatus`, `app/api/email/bounce`) and **per-event reminder preferences**
  with tenant self-service channel toggles (`lib/reminders/pref.ts`, portal notifications).
- **Asset warranty alerts** (`lib/maintenance/warranty.ts`, surfaced on `/assets`).
- **Staff 2FA/TOTP** — optional, org-enforceable (#132, `lib/auth/totp.ts`, `/2fa`, Settings →
  Security; break-glass exempt).
- **Full UI-consistency harden** (#134–#136): every staff list/detail page on a shared `PageHeader`
  with real empty/loading states, single-`h1` a11y, light/dark/mobile parity, and a refined Settings
  nav (vertical sidebar + compact mobile disclosure). A cross-app polish pass, not a gap item.

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
tenantPortal, applications, payerPortal, inspections, publicSite, portalLedgerExport, payments,
portfolio**.

- **Money/ledger core** — integer-cent ledger as source of truth, FIFO allocation, reversals,
  idempotent charge/late-fee generation, deposit→ledger move-out + damage chargeback (#123).
- **Leasing** — templates + e-sign (multi-signer, landlord-applied), renewals (extend/successor,
  portal + dashboard, #117–120), **amendments/addenda** (#128), lease abstract (#85), co-tenants,
  prorate-on-move-in, lease-expiration alerts + weekly digest + window (#81/#122).
- **Payments** — gateway seam with **real Stripe** + stub, HMAC webhooks → idempotent ledger,
  digital receipts, payer attribution; **offline self-report → staff-confirm queue** with hybrid
  methods (#131); payment-method preference read on portal + staff.
- **Maintenance & inspections** — work-order lifecycle + assignee + SLA (#77), preventive-maint log
  (#79), asset/warranty registry + **warranty alerts** (#80), vendors, turnover/make-ready (#124),
  inspection templates + per-item photos + printable report (#125), unified inspection items (#126).
- **Comms** — two-way SMS inbox (#75), SMS+email reminders with delivery tracking (#86), consent
  audit (STOP/START), inbound email, **email bounce + auto-suppression** (#130), **per-event
  reminder preferences + portal self-service toggles** (#130), per-tenant activity timeline
  (#73/#78), staff digests, **E.164 normalization + auto-consent-on-first-contact** (#150),
  **timezone-resilient billing worker** (#151), **two-way Telnyx hardening** (#152/153), and
  **granular staff alerts** (payment recorded / maintenance request) + a self-cleaning
  consent-flow test command (#154).
- **Portal** — tenant portal (balance/ledger/receipts/documents, notices #82, maintenance requests +
  photos #71, renewal acceptance #119, ledger CSV + filters #121), payer portal.
- **Reporting** — 8 CSV report types (`/api/reports/[type]`), audit-log CSV (#83), per-property
  financials/P&L, **PDF/Excel export + scheduled email delivery** (#130), **operating KPIs +
  period-over-period/YoY** on the dashboard (#130), vacancy outlook.
- **Portfolio (own-LLC)** — `Property.legalEntityName` tag + per-entity expected/collected/net
  rollup on Financials (#130).
- **Leasing funnel** — public `/apply` + `/applications`, public site, and a public **`/vacancies`**
  browse page (#130).
- **Platform** — capability/RBAC matrix (Settings → Permissions), break-glass, OIDC, **staff
  2FA/TOTP** optional + org-enforceable (#132), ⌘K search (#74), in-list DataTable search +
  history-aware back-links (#127), **app-wide UI consistency harden** (#134–#136), **org-timezone
  timestamp rendering** across every staff page (#155), mobile nav, two themes.

> **Live-DB verification debt (still open).** Most PRs cleared types+tests+lint+review. Render- or
> live-verified this session: amendments (#128), deposits (#123), the payment balance-safety
> invariant + 2FA break-glass bypass (#131/#132), and the full UI harden across light/dark/mobile
> (#134–#136). The own-LLC/portfolio, `/vacancies`, email-bounce, and reminder-preference migrations
> from #130 — plus the older #79/#80/#86 migrations and the worker schedules — still want a one-time
> `prisma:deploy` + `/verify` pass against a live DB.

---

## Focus areas — what's left (deduplicated, prioritized)

### 1. Owner-operator tax & money clarity — accounting *(untouched — highest remaining ROI)*
Nothing in this cluster has shipped; it's the highest non-payment ROI for a solo landlord at tax time.
- `[GAP] V:H E:M 🔥` — **Owner draws/withdrawals** — log personal draws/reimbursements against a
  property; Financials shows net "before vs after draws." New table + `ownerDraws` flag; audited.
- `[GAP] V:M E:M` — **Schedule-E / tax-summary export** — per-property gross rent, expenses by
  category, mortgage interest, depreciation (from `Property.purchaseDate` + cost) → PDF/CSV. Now
  rides the shipped report PDF/Excel engine (#130).
- `[GAP] V:M E:M` — **Mortgage amortization schedule** — principal/interest from existing Property
  financing fields; pure `lib/accounting/mortgage.ts`, read-only view under `/financials`.
- `[GAP] V:M E:L 🔥` — Bank-reconciliation stub (CSV match payments/expenses) — *heavier; defer.*

### 2. Finish online payments (🔥 payments hot zone)
Self-report→confirm and the payment-method preference shipped (#131); the recurring + reliability
cases remain.
- `[GAP] V:M E:M 🔥` — **Failed-payment / webhook visibility** — webhook failures are silent; add a
  `PaymentWebhookAttempt` log + a staff "failed gateway payments" view. `app/api/payments/webhook`.
- `[GAP] V:H E:L 🔥` — **In-portal autopay (recurring)** — saved method → auto-charge on the due
  date; builds on the Stripe adapter (Checkout `setup`/subscription mode) + the idempotent
  webhook→ledger path. Needs a careful consent/idempotency pass. `lib/providers/payment/stripe.ts`.
- `[GAP] V:M E:M` — **Payer-portal Pay-now** — the payer portal is read-only; let subsidy payers
  self-pay via the same gateway seam. `app/payer-portal/` + extend `startCheckout`.

### 3. Reporting & comms cohesion
PDF/Excel export, KPIs/PoP, email bounce, and reminder prefs shipped (#130); the cohesion items remain.
- `[POLISH] V:M E:S 🔥` — **Saved filters / named views** (small `SavedFilter` table) for the
  repeated Leases/Reports filters.
- `[COHESION] V:M E:S` — **Consolidated message center** — unify SMS inbox + email inbox + notices
  into one filtered view. `app/(app)/inbox/`.
- `[POLISH] V:M E:M` — Recipient segmentation/preview on bulk sends.

### 4. Fill vacancies faster — leasing funnel
The public `/vacancies` page shipped (#130); the follow-on polish remains.
- `[POLISH] V:M E:S` — **Application confirmation email** + a **dashboard applications widget**
  (submitted/reviewing count) mirroring the expirations card. Today only the on-screen confirmation
  *text* exists; no email is sent. Reuses the email provider seam.

### 5. Resident-experience polish — portal
- `[POLISH] V:M E:S 🔥` — **Tenant account page** — edit contact, change password, channel/consent
  prefs, login history; consolidates today's scattered home-page toggles. *(portal auth lane)*
- `[COHESION] V:M E:S` — **Unified portal nav** + document type-filter/search + maintenance-request
  **status timeline** (staff replies visible to the tenant).

### 6. Maintenance & asset cohesion
Warranty alerts shipped (`warranty.ts` + `/assets`).
- `[GAP] V:M E:M` — **Maintenance cost rollup/forecast** per property/asset by period.
- `[POLISH] V:M E:S` — Maintenance-job **CSV export** + tags/search (parity with other lists).

### 7. Platform & security (hot zone — ask first)
Staff 2FA/TOTP shipped (#132).
- `[POLISH] V:M E:S` — **Per-user session/login history** (lighter security win; `UserSession` table).
- `[GAP] V:M E:M` — **CSV import + onboarding wizard** — day-1 bulk load (properties/units/leases/
  tenants); rated a high day-1 unlock. No ledger touch.

### 8. Leasing follow-ups (smaller)
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
  rollup, now shipped (#130), is the in-scope slice.)*
- **B. Deep accounting** (full GL, A/P + bill pay, bank rec, accrual P&L, budget-vs-actual) —
  enterprise bookkeeping. *(Exceptions in scope: deposit→ledger #123, owner draws + Schedule-E §1.)*
- **C. Collections/ACH depth** (programmatic ACH orchestration, NSF/returns, payment plans, fee
  pass-through, delinquency workflow) — not selected. *(In-portal autopay §2 is in scope and rides
  the existing Stripe rails; NSF only becomes ROI-positive at higher ACH volume.)*
- **F. Full leasing funnel** (syndication/listings to Zillow/Apartments.com, ATS/lead scoring,
  real screening provider, application fees) — deferred. *(The shipped `/vacancies` page + the
  confirmation email in §4 is the in-scope slice on top of `/apply` + the public site.)*
- Trigger→action **workflow engine**, public **REST API + keys**, vendor portal + dispatch, PWA —
  enterprise-heavy for a solo operator; revisit on a specific ask.

---

## Next up — recommended order

Grounded in small-operator ROI, with hot zones flagged for ask-first. The big enterprise-gap batch
(payments self-report, portfolio/own-LLC, vacancies, reporting export + KPIs, comms hardening, 2FA)
and the app-wide UI harden have shipped — the highest-ROI **untouched** cluster is now tax/accounting
clarity.

1. **Owner-operator tax clarity** (§1) — owner draws 🔥 + Schedule-E export (rides the shipped report
   PDF/Excel engine) + mortgage amortization. Entirely unbuilt; highest remaining ROI at tax time.
2. **Finish payments** (§2) — failed-payment visibility, then **autopay** 🔥 (saved method →
   due-date charge on the existing Stripe rails), then payer-portal Pay-now.
3. **Clean parallelizable batch (no hot zone):** application **confirmation email + dashboard widget**
   (§4), **consolidated message center** (§3), **lease abstract enrichment** (§8), maintenance
   **cost rollup + CSV export** (§6). Good for parallel worktree agents.
4. **Portal & onboarding:** tenant **account page** 🔥 (§5) + **CSV import / onboarding wizard** (§7).
5. **Hot zones, on explicit go-ahead:** autopay (§2), owner draws (§1), guarantor/co-signer (§8),
   saved filters (§3).

Build each with `/feature-intake`; refresh this file with `/competitive-audit` as the app evolves.
