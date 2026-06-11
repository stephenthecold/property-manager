import { DateTime } from "luxon";
import { type Cents, minCents, percentOfBps } from "@/lib/money";
import { daysBetween, graceDeadline } from "@/lib/accounting/periods";

export type LateFeeType = "none" | "fixed" | "percentage" | "daily";

/**
 * One-shot late fee for one period (fixed / percentage). The percentage base
 * is the immutable rent_charge amount for that period (NOT a non-derivable
 * "outstanding"), so the fee is deterministic and order-independent
 * regardless of prior credits/partials. The `daily` type accrues per day via
 * {@link dailyLateFeeAccruals} instead and returns 0 here.
 */
export function computeLateFeeCents(opts: {
  type: LateFeeType;
  rentChargeCents: Cents;
  fixedAmountCents?: Cents | null;
  bps?: number | null;
}): Cents {
  switch (opts.type) {
    case "fixed":
      return opts.fixedAmountCents ?? 0n;
    case "percentage":
      return percentOfBps(opts.rentChargeCents, opts.bps ?? 0);
    default:
      return 0n;
  }
}

export interface DailyLateFeeAccrual {
  /** 1-based day past the grace deadline (day 1 = first chargeable day). */
  day: number;
  amountCents: Cents;
  /** The civil day (midnight, property tz) the fee accrued. */
  accruedOn: Date;
}

/**
 * Daily late-fee accruals for one period as of `now`: one entry per whole day
 * past `dueDate + graceDays` (property tz), at `dailyRateCents` per day,
 * optionally capped at `capCents` total per period (the capping day may be a
 * partial amount).
 *
 * Resume semantics: the caller passes what is ALREADY POSTED for the period
 * (`fromDay` = highest posted day index, `alreadyAccruedCents` = sum of posted
 * day rows) and only days after `fromDay` are returned, with the cap enforced
 * against the actual posted total. Rate/cap edits mid-delinquency therefore
 * apply prospectively and can never overshoot the cap or stall below it.
 */
export function dailyLateFeeAccruals(opts: {
  dueDate: Date;
  graceDays: number;
  tz: string;
  now: Date;
  dailyRateCents: Cents;
  capCents?: Cents | null;
  /** Highest day index already posted for this period (default 0 = none). */
  fromDay?: number;
  /** Sum of already-posted day rows for this period (default 0). */
  alreadyAccruedCents?: Cents;
}): DailyLateFeeAccrual[] {
  const { dueDate, graceDays, tz, now, dailyRateCents, capCents } = opts;
  if (dailyRateCents <= 0n) return [];

  const deadline = graceDeadline(dueDate, graceDays, tz);
  const daysLate = daysBetween(deadline, now, tz);
  if (daysLate <= 0) return [];

  const deadlineDay = DateTime.fromJSDate(deadline, { zone: tz }).startOf("day");
  const accruals: DailyLateFeeAccrual[] = [];
  let total = opts.alreadyAccruedCents ?? 0n;
  for (let day = (opts.fromDay ?? 0) + 1; day <= daysLate; day++) {
    let amount = dailyRateCents;
    if (capCents != null) {
      amount = minCents(amount, capCents - total);
      if (amount <= 0n) break; // cap reached against the POSTED total
    }
    total += amount;
    accruals.push({
      day,
      amountCents: amount,
      accruedOn: deadlineDay.plus({ days: day }).toJSDate(),
    });
  }
  return accruals;
}

/** Ledger periodKey for one accrued day: "<duePeriodKey>+d<N>". */
export function dailyLateFeePeriodKey(periodKey: string, day: number): string {
  return `${periodKey}+d${day}`;
}
