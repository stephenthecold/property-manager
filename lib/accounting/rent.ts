import { DateTime } from "luxon";
import type { Cents } from "@/lib/money";

/**
 * Per-period rent amount: base rent (current or scheduled-increase), plus the
 * unit's internet add-on. Pure and clock-free — callers pass the period's key
 * ("YYYY-MM-DD" due date in the property tz) and the property tz, so the same
 * inputs always price a period the same way regardless of when billing runs.
 *
 * A scheduled increase applies to periods whose due date is on/after the
 * effective date (no mid-period proration, matching the documented Phase-1
 * simplifications). Once the date has passed, the worker rolls
 * `rentAmountCents` forward (see `shouldApplyScheduledRent`) — already-charged
 * periods are never touched thanks to the per-period idempotency indexes.
 *
 * Caveat: the internet add-on is NOT effective-dated. It prices at the unit's
 * current configuration, so a back-filled due-but-unbilled period gets today's
 * internet config — unlike base rent, which back-fills historically via the
 * schedule fields. See docs/accounting.md "Monthly charge composition".
 */

export interface RentTerms {
  rentAmountCents: Cents;
  scheduledRentAmountCents?: Cents | null;
  scheduledRentEffectiveDate?: Date | null;
  /** Unit add-on: include internet service in the monthly charge. */
  internetEnabled?: boolean;
  internetFeeCents?: Cents | null;
}

export interface RentBreakdown {
  baseRentCents: Cents;
  internetFeeCents: Cents;
  totalCents: Cents;
  /** True when the scheduled-increase amount priced this period. */
  scheduledApplied: boolean;
}

/** The effective date's civil day in the property tz, as a "YYYY-MM-DD" key. */
function effectiveKey(date: Date, tz: string): string {
  return DateTime.fromJSDate(date, { zone: tz }).toFormat("yyyy-MM-dd");
}

export function rentForPeriod(
  terms: RentTerms,
  periodKey: string,
  tz: string,
): RentBreakdown {
  const hasSchedule =
    terms.scheduledRentAmountCents != null &&
    terms.scheduledRentEffectiveDate != null;
  const scheduledApplied =
    hasSchedule &&
    periodKey >= effectiveKey(terms.scheduledRentEffectiveDate as Date, tz);

  const baseRentCents = scheduledApplied
    ? (terms.scheduledRentAmountCents as Cents)
    : terms.rentAmountCents;
  const internetFeeCents = terms.internetEnabled
    ? (terms.internetFeeCents ?? 0n)
    : 0n;

  return {
    baseRentCents,
    internetFeeCents,
    totalCents: baseRentCents + internetFeeCents,
    scheduledApplied,
  };
}

/**
 * The expected monthly charge under the CURRENT terms (base rent + internet
 * add-on, ignoring any pending scheduled increase). Use this — not bare
 * `rentAmountCents` — anywhere a "monthly rent" figure is shown or summed
 * (rent roll, dashboard expectations, reminder fallbacks), so displays match
 * what billing actually charges.
 */
export function expectedMonthlyChargeCents(
  terms: Pick<RentTerms, "rentAmountCents" | "internetEnabled" | "internetFeeCents">,
): Cents {
  return (
    terms.rentAmountCents +
    (terms.internetEnabled ? (terms.internetFeeCents ?? 0n) : 0n)
  );
}

/**
 * Whether a pending scheduled increase should be rolled into `rentAmountCents`
 * (its effective date has arrived in the property tz). Run AFTER charge
 * generation in a billing pass so back-filled periods before the effective
 * date still price at the old rent.
 */
export function shouldApplyScheduledRent(
  terms: Pick<RentTerms, "scheduledRentAmountCents" | "scheduledRentEffectiveDate">,
  now: Date,
  tz: string,
): boolean {
  if (
    terms.scheduledRentAmountCents == null ||
    terms.scheduledRentEffectiveDate == null
  ) {
    return false;
  }
  const effective = DateTime.fromJSDate(terms.scheduledRentEffectiveDate, {
    zone: tz,
  }).startOf("day");
  return DateTime.fromJSDate(now, { zone: tz }) >= effective;
}
