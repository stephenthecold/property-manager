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

## ✅ Shipped this session

Built across parallel worktree-agent batches (each through the verification gate + `/code-review`,
`/security-review` where it applied):

- **E** — Maintenance-request photos (#71) · **I** — Per-tenant activity timeline (#73) + inbound-SMS
  source (#78) · **I** — ⌘K global search (#74) · **H** — Two-way SMS inbox (#75) · **G** — Work-order
  lifecycle + assignee + SLA (#77) · **G** — Preventive-maintenance execution log (#79) · **G** —
  Asset/warranty registry (#80) · **D** — Lease-expiration alerts (#81) · **E** — Portal notices inbox
  (#82) · **I** — Audit-log CSV export (#83).
- Plus tooling: the `/competitive-audit` + `/feature-intake` skills (#70) and the CLAUDE.md
  "parallelize with agents" clause (#72).

Already present in `main` before this pass (don't rebuild): **Inspections** (lease-scoped, with items),
**reports CSV export** (`/api/reports/[type]`), **audit-log filters**, and partial reminder delivery
status (`ReminderStatus` delivered/failed + `recordDeliveryStatus`).

---

## Focus areas — what's left

### D. Leasing lifecycle
- ✅ **#81** Lease-expiration alerts — *shipped as a dashboard section.* Follow-up: the weekly **digest**
  + a configurable window (`AppSettings.leaseExpirationAlertDays`) are still open.
- `[GAP] V:H E:M` — **Renewal offer→acceptance** — staff mints an offer (new rent/term), tenant
  accepts + e-signs. New `LeaseRenewalOffer`; reuse e-sign token/signature path (`SigningRequest.kind`).
- `[COHESION] V:H E:M` — 🔥 **Deposit→ledger move-out statement** — itemize deductions, post refund or
  balance-owed as ledger entries (`sourceType="inspection_disposition"`). Touches `postPayment`/ledger.
- `[POLISH] V:M E:S` — **Lease abstract** — one-page printable summary from `AgreementContext`.
- `[GAP] V:M E:M` — **Amendments/addenda** — rider text + signature (`SigningRequest.kind="amendment"`).
- `[POLISH] V:M E:S` — **Prorate-first-period UI** — `Lease.prorateFirstPeriod` exists; expose at create.
- `[GAP] V:M E:L` — Guarantor/co-signer; bulk lease term actions.

### E. Resident portal
- ✅ **#71** Maintenance-request photos. ✅ **#82** Notices inbox.
- `[GAP] V:H E:M` — In-portal **autopay enrollment** *(depends on a real payment gateway — see C)*.
- `[GAP] V:H E:S` — **Renewal acceptance in portal** (pairs with D renewal flow).
- `[POLISH] V:M E:S` — Ledger date/type filters + **tenant CSV download** of their ledger; payment-method
  hint on Pay-now.
- `[GAP] V:M E:L` — PWA/offline.

### G. Maintenance & ops
- ✅ **#77** Work-order lifecycle + assignment + SLA. ✅ **#79** Preventive-maintenance execution log.
  ✅ **#80** Asset/warranty registry.
- `[POLISH] V:M E:M` — **Inspection templates + photos + report** — *Inspections exist;* the gap is
  reusable templates (predefined item lists), photo capture on items, and a printable report.
- `[COHESION] V:M E:S` — 🔥 **Damage chargeback** from a move-out inspection item → ledger (with D).
- `[COHESION] V:M E:S` — Turnover/make-ready checklist/Kanban; parts/inventory tags.
- `[POLISH] V:M E:S` — Link an `Asset` to a `MaintenanceJob` (`MaintenanceJob.assetId`) — deferred out
  of #80 to keep it standalone.
- `[GAP] V:H E:L` — Vendor portal + dispatch *(deferred — small operators usually text their contractor).*

### H. Comms & automation
- ✅ **#75** Two-way SMS inbox. (Notification center / message log is largely covered by the activity
  timeline + the inbox.)
- `[GAP] V:M E:M` — **Delivery/read + bounce tracking** — `ReminderStatus` already has delivered/failed +
  `recordDeliveryStatus`; the gap is `deliveredAt`/`failedReason` timestamps + surfacing status in the
  reminders view.
- `[POLISH] V:M E:S` — Per-event reminder preferences; bulk audience segmentation.
- `[GAP] V:M E:L` — Trigger→action **workflow engine** *(deferred — enterprise-heavy for a small operator).*

### I. Platform cohesion
- ✅ **#74** ⌘K global search. ✅ **#73**+**#78** Unified activity timeline. ✅ **#83** Audit-log CSV export.
- `[GAP] V:L E:M` — **CSV import + onboarding wizard** — templated bulk load (properties/tenants/leases).
- `[GAP] V:M E:M` — 🔥 Staff **2FA/TOTP** (touches auth).
- `[POLISH] V:M E:S` — Saved filters/named views; report **PDF/Excel** (CSV exists) + scheduled delivery +
  period-over-period + occupancy/turnover KPIs; empty/loading/error + a11y polish.
- `[GAP] V:H E:L` — Public **REST API + keys** + integrations (QuickBooks/Plaid/Zillow) *(deferred).*

---

## Deferred initiatives (deliberate — don't re-litigate without a new decision)

- **A. Owner / portfolio layer** — deferred: operator runs their *own* properties. Revisit if they start
  managing for third-party owners.
- **B. Accounting depth** (GL, A/P + bill pay, bank rec, accrual P&L, budget-vs-actual) — enterprise
  bookkeeping; deferred. *(Exception: the deposit→ledger bridge in D is in scope.)*
- **C. Payments & collections depth** (real ACH, NSF/returns, payment plans, fee pass-through,
  delinquency workflow) — not selected. In-portal **autopay** (E) needs a real gateway first.
- **F. Leasing funnel** (listings/syndication, ATS, screening, application fees) — not selected.

---

## Next up — recommended order

**Clean (no hot zone), good for parallel worktree agents** — best done once the open PRs merge, so
schema additions don't cascade-conflict:
1. **Renewal offer→acceptance** (D + E) — the biggest remaining small-operator win; new `LeaseRenewalOffer`,
   reuse the e-sign path.
2. **Delivery/read tracking finish** (H) — timestamps + surface status in the reminders view.
3. **Turnover/make-ready checklist** (G) and **Asset↔Job link** (G).
4. **Lease-expiration digest** (D follow-up) and **tenant ledger CSV** (E).

**Hot zones — need an explicit go-ahead + blast-radius writeup first** (CLAUDE.md):
- 🔥 **Deposit→ledger move-out statement** (D) — posts real ledger entries; blast radius = tenant balances.
- 🔥 **Damage chargeback → ledger** (G, pairs with the above).
- 🔥 **Staff 2FA/TOTP** (I) — touches the auth/session lane.

Build each with `/feature-intake`; refresh this file with `/competitive-audit` as the app evolves.
