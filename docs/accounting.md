# Accounting model

The accounting core is the highest-correctness-risk part of the system. It lives in
pure, dependency-free modules under [`lib/money.ts`](../lib/money.ts) and
[`lib/accounting/`](../lib/accounting/), and is exercised by a unit-test matrix
([`lib/**/*.test.ts`](../lib/accounting/)). The DB layer ([`lib/services/`](../lib/services/))
only loads rows and persists results — it never re-implements money logic.

## Money

- **Everything is integer cents (`bigint`).** Never floats, never `Number(cents)` for math.
- [`lib/money.ts`](../lib/money.ts) is the *only* place currency is parsed, formatted, or
  arithmetic'd: `toCents` / `fromCents` / `formatCurrency`, `sumCents`, and `percentOfBps`
  (half-up rounding done in bigint). It also provides `bigintReplacer` / `toMoneyDTO` for
  the RSC→client boundary (bigint is not JSON-serializable; cross the wire as strings).

## The ledger is the single source of truth

- A lease's **net balance = `SUM(amountCents)` over *all physical* `LedgerEntry` rows** for
  that lease. There is **no `voided_at` filter** in the sum.
- Sign convention: **`+` increases what the tenant owes** (`rent_charge`, `late_fee`),
  **`-` decreases it** (`payment`, `credit`). `balance > 0` ⇒ owes; `balance < 0` ⇒ credit.
- **Nothing is ever mutated or deleted for balance purposes.** A correction is a new
  offsetting **`reversal`** entry (`amountCents = -original`, `reversesEntryId = original.id`).
  This is why voiding a $1,200 charge moves the balance by exactly 1,200 — not 2,400.
- Balance scope is **per `leaseId`**. Credit never crosses leases via an unscoped sum;
  end-of-lease credit is handled by an explicit transfer/refund adjustment.

## Charges and periods

- Rent charges are **materialized** `rent_charge` rows written by the billing worker
  ([`lib/services/billing.ts`](../lib/services/billing.ts)), not computed on read.
- A period is keyed by its **due date** (`periodKey = "YYYY-MM-DD"`), computed in the
  **property's IANA timezone** with `dueDay` clamped to the last day of short months.
- Idempotency is enforced by **partial unique indexes**
  `UNIQUE(leaseId, periodKey) WHERE entryType IN (rent_charge | late_fee)` (raw SQL in the
  migration). The generator inserts with per-row "skip on conflict", so concurrent/retried
  runs converge to exactly one charge per period. It also **back-fills** any periods missed
  during downtime.

## Payments — strict per-charge FIFO

- A `Payment` row (the human/event record) and its single negative `LedgerEntry` are created
  in **one transaction**, keyed by a **client-minted `idempotencyKey`** (UNIQUE) so a
  double-submit is a no-op.
- The payment is applied to open charges **oldest-first** (`ChargeAllocation` rows). Leftover
  becomes **tenant credit** (a naturally negative balance). Per-charge outstanding drives the
  **aging report** (current / 1–30 / 31–60 / 61–90 / 90+).
- `pending` payments write **no** ledger entry; only `posted` ones do. So the balance is
  always reconstructable from the physical ledger table alone.

## Late fees

- Config per lease: `late_fee_type` ∈ {none, fixed, percentage, daily}, with
  `late_fee_amount_cents` (fixed amount, or per-day rate for daily) or `late_fee_bps`,
  plus `grace_period_days` and an optional `late_fee_max_cents` cap (daily only).
- Fixed/percentage fees are assessed once per period (idempotent via the partial index)
  when a period's `rent_charge` is still net-unpaid past `due_date + grace`. The
  **percentage base is the immutable `rent_charge` amount** for that period —
  deterministic regardless of prior partials/credits. Switching a lease between one-shot
  and daily types never stacks both shapes on one period (each branch skips periods the
  other already assessed).
- Since the unit **internet add-on is folded into the `rent_charge`** amount
  (`rentForPeriod` in [`lib/accounting/rent.ts`](../lib/accounting/rent.ts)), a percentage
  late fee is computed on the full charge **including the internet fee**. This is a
  deliberate v1 decision (pinned by a unit test); the rent/internet split is recorded in
  the charge's description string.

- **Daily late fees** (`late_fee_type = daily`): `late_fee_amount_cents` accrues per whole
  day past `due_date + grace` (property tz), one ledger row per day with periodKey
  `"<period>+dN"` — idempotent per day under the same partial unique. Accrual stops when
  the charge is paid (no row is ever removed) or the optional `late_fee_max_cents` cap is
  reached (the capping day may be a partial amount). E.g. "$10/day after the first 5 days"
  = grace 5, daily rate $10.

## Monthly charge composition (internet add-on, scheduled increases)

- Each generated `rent_charge` = base rent + the **lease's** internet fee (if enabled),
  priced per period by the pure `rentForPeriod`. The unit's internet fields are only the
  default for new leases. A **scheduled rent increase** applies to periods
  whose due date falls on/after the effective date (property tz, no proration); once due,
  the worker rolls `rentAmountCents` forward and clears the schedule (audited, CAS-guarded).
- Already-charged periods are never repriced (append-only ledger + idempotency index), so
  scheduling an increase into an already-charged period is rejected at the action layer.
- **Simplification:** internet add-on changes are *not* effective-dated. A back-filled
  period (worker downtime) prices at the lease's *current* internet config, unlike base
  rent which back-fills historically via the schedule fields.
- **First-month proration** (opt-in per lease at creation): a mid-period start posts one
  partial `rent_charge` for `startDate` through the day before the first full due date, at
  `monthly total × days / daysInMonth(start month)` (half-up). It is keyed to the
  otherwise-never-billed move-in period, so the standard idempotency index applies.
  Skipped for next-due-date imports (the opening balance carries partial-month rent).

## Status derivation

`deriveStatus` ([`lib/accounting/status.ts`](../lib/accounting/status.ts)) is pure with strict
precedence: **vacant > no_active_lease > (paid / partially_paid / overdue / due_soon)**.
Financial statuses are **current-period scoped** — a tenant with old arrears whose current
period is covered shows `paid`, with global arrears surfaced separately (e.g. a past-due chip).

## Adjustment vs reversal (operator guidance)

- Use a **`reversal`** to undo one specific wrong entry (auto-negation, `reversesEntryId`).
- Use an **`adjustment`** only for a genuine new economic event (waiver, discount, concession),
  never to undo a mistake. Don't do both for one correction — the ledger UI surfaces
  `reversesEntryId` / `reason` so operators can see a correction already exists.
  Arithmetic stays correct regardless (everything is additive and reconstructable).

## Phase 2–5 extension seams

- `LedgerEntry.sourceType` / `sourceId` link entries to their origin (payment, charge, …) and
  let **receipts/uploads** (Phase 2) attach without schema churn.
- Swappable `FileStorage` / `SmsProvider` interfaces ([`lib/providers/`](../lib/providers/)).
- `AuditLog` (append-only) backs the Phase-4 **audit viewer** (read-only UI over existing data).
