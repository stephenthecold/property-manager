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
  (#82) · **I** — Audit-log CSV export (#83) · **D** — Printable lease abstract (#85) · **H** —
  Reminder delivery tracking (#86).
- **Later batch (this session):** **D** — Renewal offer→acceptance (extend or successor lease) with
  portal + dashboard surfacing and successor-handoff hardening (#117–#120) · **E** — tenant ledger CSV
  export (#121) · **D** — lease-expiration weekly digest + configurable window (#122) · **D/G** — 🔥
  deposit→ledger move-out statement + damage chargeback, applying the deposit as a FIFO-allocated credit
  so the open-charge/aging view stays consistent (#123).
- Plus tooling: the `/competitive-audit` + `/feature-intake` skills (#70) and the CLAUDE.md
  "parallelize with agents" clause (#72).

Already present in `main` before this pass (don't rebuild): **Inspections** (lease-scoped, with items),
**reports CSV export** (`/api/reports/[type]`), **audit-log filters**, and partial reminder delivery
status (`ReminderStatus` delivered/failed + `recordDeliveryStatus`).

> **Verification status (top open task).** Every shipped PR cleared typecheck + unit tests + lint +
> `/code-review` (+ `/security-review` on webhook/portal/new-surface changes), each independently
> re-verified before merge. They were **not** exercised against a live DB/browser in the build
> environment, so the 4 new migrations (#79/#80/#86 add tables/columns), the rendered pages, and the
> worker flows still need a one-time pass: `docker compose up -d db` → `npm run prisma:deploy` →
> `npm run db:seed` → drive with `/run` or `/verify` (check both themes + that the migrations apply).

---

## Focus areas — what's left

### D. Leasing lifecycle
- ✅ **#81** Lease-expiration alerts — *shipped as a dashboard section.* The weekly **digest** + a
  configurable window (`AppSettings.leaseExpirationAlertDays`) shipped in **#122**.
- ✅ **#117** **Renewal offer→acceptance** — staff mint an offer (new rent/term), tenant accepts +
  e-signs via the existing token/signature path (extend-in-place or successor lease). Follow-ups:
  dashboard entry (**#118**), portal surfacing (**#119**), successor-handoff hardening (**#120**).
- ✅ **#123** 🔥 **Deposit→ledger move-out statement** — itemize deductions; finalize posts damages as a
  charge and the applied deposit as a FIFO-allocated credit (retiring open charges so aging stays
  consistent), recording the refund due. `sourceType="deposit_disposition"`.
- ✅ **#85** **Lease abstract** — one-page printable summary (links from the agreement page + leases list).
- `[GAP] V:M E:M` — **Amendments/addenda** — rider text + signature (`SigningRequest.kind="amendment"`).
- `[POLISH] V:M E:S` — **Prorate-first-period UI** — `Lease.prorateFirstPeriod` exists; expose at create.
- `[GAP] V:M E:L` — Guarantor/co-signer; bulk lease term actions.

### E. Resident portal
- ✅ **#71** Maintenance-request photos. ✅ **#82** Notices inbox.
- `[GAP] V:H E:M` — In-portal **autopay enrollment** *(depends on a real payment gateway — see C)*.
- ✅ **#119** **Renewal acceptance in portal** — pending offers surfaced read-only in the resident portal.
- ✅ **#121** Ledger date/type filters + **tenant CSV download** of their ledger (settings-gated module).
  *(Payment-method hint on Pay-now remains.)*
- `[GAP] V:M E:L` — PWA/offline.

### G. Maintenance & ops
- ✅ **#77** Work-order lifecycle + assignment + SLA. ✅ **#79** Preventive-maintenance execution log.
  ✅ **#80** Asset/warranty registry.
- `[POLISH] V:M E:M` — **Inspection templates + photos + report** — *Inspections exist;* the gap is
  reusable templates (predefined item lists), photo capture on items, and a printable report.
- ✅ **#123** 🔥 **Damage chargeback** — move-out deductions post to the ledger as part of the deposit
  disposition (see D).
- `[COHESION] V:M E:S` — Turnover/make-ready checklist/Kanban; parts/inventory tags.
- `[POLISH] V:M E:S` — Link an `Asset` to a `MaintenanceJob` (`MaintenanceJob.assetId`) — deferred out
  of #80 to keep it standalone.
- `[GAP] V:H E:L` — Vendor portal + dispatch *(deferred — small operators usually text their contractor).*

### H. Comms & automation
- ✅ **#75** Two-way SMS inbox. (Notification center / message log is largely covered by the activity
  timeline + the inbox.)
- ✅ **#86** **Delivery tracking** — `deliveredAt` + `failedReason` added; status surfaced in the
  reminders view. (Read receipts / bounce categorization remain a possible extension.)
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

**Shipped since this list was last ordered:** Renewal offer→acceptance + portal + dashboard + hardening
(#117–#120), tenant ledger CSV (#121), lease-expiration digest + window (#122), and the 🔥
deposit→ledger move-out statement + damage chargeback with FIFO open-charge retirement (#123).

**Still clean (no hot zone), good for parallel worktree agents:**
1. **Turnover/make-ready checklist** (G) and **Asset↔Job link** (`MaintenanceJob.assetId`, G).
2. **Inspection templates + photos + report** (G) — reusable item lists, per-item photos, printable report.

**Hot zones — need an explicit go-ahead + blast-radius writeup first** (CLAUDE.md):
- 🔥 Staff **2FA/TOTP** (I) — touches auth.
- 🔥 **Staff 2FA/TOTP** (I) — touches the auth/session lane.

Build each with `/feature-intake`; refresh this file with `/competitive-audit` as the app evolves.
