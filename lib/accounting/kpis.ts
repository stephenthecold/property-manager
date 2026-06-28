import { DateTime } from "luxon";
import type { Cents } from "@/lib/money";

/**
 * Pure operating-KPI compute (DB-free, clock-injected) — unit-tested. The
 * `lib/services/kpis.ts` bridge loads Prisma rows into the plain inputs below
 * and renders the results; this module never touches the DB.
 *
 * Money is integer cents (bigint). Days are whole civil days. Period bucketing
 * (period-over-period) uses the PROPERTY timezone via Luxon, consistent with
 * lib/accounting/income.ts — a payment late on the last UTC day of a month can
 * belong to the next month in the property tz.
 *
 * Sign convention here is the OPERATOR's, not the ledger's: collected cash is a
 * POSITIVE amount (the service negates the ledger's payment sign before calling
 * these functions), so deltas read naturally ("+$500 vs last month").
 */

// --- Occupancy --------------------------------------------------------------

export interface Occupancy {
  occupiedUnits: number;
  /** Units that count toward occupancy (total minus off-market). */
  rentableUnits: number;
  vacantUnits: number;
  /** occupied / rentable, 0..1. Zero rentable units → 0 (avoid divide-by-zero). */
  rate: number;
}

/**
 * Point-in-time occupancy. Occupancy is lease-derived (a unit is occupied iff it
 * has an active lease); the denominator is RENTABLE units — total minus the ones
 * intentionally pulled off-market (serviceStatus "unavailable"). Counts are
 * pre-computed by the caller so this stays a trivial, DB-free ratio.
 */
export function computeOccupancy(input: {
  occupiedUnits: number;
  /** All units in scope (every Unit row). */
  totalUnits: number;
  /** Units manually flagged off-market (serviceStatus = "unavailable"). */
  unavailableUnits: number;
}): Occupancy {
  const rentableUnits = Math.max(0, input.totalUnits - input.unavailableUnits);
  // Occupied can never exceed rentable (an occupied unit is, by definition, not
  // off-market — occupancy wins over serviceability). Clamp defensively so a
  // data anomaly can't push the rate above 100%.
  const occupiedUnits = Math.min(input.occupiedUnits, rentableUnits);
  const vacantUnits = Math.max(0, rentableUnits - occupiedUnits);
  const rate = rentableUnits === 0 ? 0 : occupiedUnits / rentableUnits;
  return { occupiedUnits, rentableUnits, vacantUnits, rate };
}

// --- Vacant days + lost rent ------------------------------------------------

export interface VacantUnitInput {
  /** Property IANA timezone — vacancy days are counted in civil days here. */
  tz: string;
  /**
   * When the unit became vacant: the most-recent ended lease's endDate, or the
   * unit's createdAt if it has never been leased. null = unknown start → the
   * lookback window cap is used as the vacancy length.
   */
  vacantSince: Date | null;
  /** The unit's market/last rent (defaultRentAmountCents), per full month. */
  marketRentCents: Cents;
}

export interface VacantUnitResult {
  daysVacant: number;
  lostRentCents: Cents;
}

export interface VacancyLoss {
  vacantUnits: number;
  totalDaysVacant: number;
  /** Σ over vacant units of daysVacant × (monthly rent / 30). */
  totalLostRentCents: Cents;
  perUnit: VacantUnitResult[];
}

/** Daily rent from a monthly figure: monthly / 30, truncating (bigint). */
export function dailyRentCents(monthlyRentCents: Cents): Cents {
  const abs = monthlyRentCents < 0n ? 0n : monthlyRentCents;
  return abs / 30n;
}

/**
 * Estimated lost rent across currently-vacant units. Per unit: whole days vacant
 * (capped at `maxLookbackDays` so a long-idle or never-leased unit doesn't dwarf
 * the figure) × the unit's daily market rent. `now` is injected.
 *
 * A unit whose vacancy "start" is in the FUTURE (clock skew / a same-day move-out
 * recorded with a forward date) yields 0 days, never negative.
 */
export function computeVacancyLoss(
  units: readonly VacantUnitInput[],
  now: Date,
  maxLookbackDays = 365,
): VacancyLoss {
  const cap = Math.max(0, Math.trunc(maxLookbackDays));
  const perUnit = units.map((u): VacantUnitResult => {
    const raw =
      u.vacantSince == null ? cap : daysVacant(u.vacantSince, now, u.tz);
    const daysVacantCapped = Math.min(cap, Math.max(0, raw));
    const lostRentCents =
      BigInt(daysVacantCapped) * dailyRentCents(u.marketRentCents);
    return { daysVacant: daysVacantCapped, lostRentCents };
  });
  return {
    vacantUnits: perUnit.length,
    totalDaysVacant: perUnit.reduce((s, u) => s + u.daysVacant, 0),
    totalLostRentCents: perUnit.reduce((s, u) => s + u.lostRentCents, 0n),
    perUnit,
  };
}

/** Whole civil days a unit has been vacant (property tz); never negative. */
export function daysVacant(vacantSince: Date, now: Date, tz: string): number {
  const start = DateTime.fromJSDate(vacantSince, { zone: tz }).startOf("day");
  const end = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  return Math.max(0, Math.round(end.diff(start, "days").days));
}

// --- Turnover cost ----------------------------------------------------------

export interface TurnoverCost {
  /** Σ finalized move-out DepositDisposition damage totals over the period. */
  moveOutDamagesCents: Cents;
  /** Σ turnover-attributed PropertyExpense rows over the period. */
  turnoverExpensesCents: Cents;
  /** moveOutDamages + turnoverExpenses. */
  totalCents: Cents;
}

/**
 * Total cost of turning units over a period: move-out damage chargebacks (from
 * finalized deposit dispositions) PLUS turnover operating expenses. The caller
 * filters both inputs to the reporting window and sums each stream; this just
 * adds the two non-negative streams so the breakdown stays visible.
 */
export function computeTurnoverCost(input: {
  moveOutDamagesCents: Cents;
  turnoverExpensesCents: Cents;
}): TurnoverCost {
  const moveOutDamagesCents =
    input.moveOutDamagesCents < 0n ? 0n : input.moveOutDamagesCents;
  const turnoverExpensesCents =
    input.turnoverExpensesCents < 0n ? 0n : input.turnoverExpensesCents;
  return {
    moveOutDamagesCents,
    turnoverExpensesCents,
    totalCents: moveOutDamagesCents + turnoverExpensesCents,
  };
}

// --- Period-over-period (collected income) ----------------------------------

export interface PeriodDelta {
  currentCents: Cents;
  priorCents: Cents;
  /** current − prior (signed). */
  deltaCents: Cents;
  /**
   * (current − prior) / prior as a fraction (0.10 = +10%). null when prior is 0
   * — a percentage off a zero base is undefined (the absolute delta still
   * carries the story). +/-Infinity is never returned.
   */
  deltaPct: number | null;
}

/** current vs prior as an absolute + (base-guarded) percentage delta. */
export function periodDelta(currentCents: Cents, priorCents: Cents): PeriodDelta {
  const deltaCents = currentCents - priorCents;
  const deltaPct =
    priorCents === 0n ? null : Number(deltaCents) / Number(priorCents < 0n ? -priorCents : priorCents);
  return { currentCents, priorCents, deltaCents, deltaPct };
}

export interface CollectedComparison {
  /** "this month" vs "last month". */
  monthOverMonth: PeriodDelta;
  /** "this month" vs "same month last year". */
  yearOverYear: PeriodDelta;
}

/**
 * Month-over-month and year-over-year deltas on collected cash. The three totals
 * (current month, prior month, same month last year) are pre-summed by the
 * caller — already in the operator's positive-collected convention.
 */
export function compareCollected(input: {
  currentMonthCents: Cents;
  priorMonthCents: Cents;
  sameMonthLastYearCents: Cents;
}): CollectedComparison {
  return {
    monthOverMonth: periodDelta(input.currentMonthCents, input.priorMonthCents),
    yearOverYear: periodDelta(
      input.currentMonthCents,
      input.sameMonthLastYearCents,
    ),
  };
}

/**
 * The three month windows (as inclusive-start / exclusive-end instants) the
 * service queries to build {@link compareCollected}: the month containing `now`,
 * the prior month, and the same month one year back. Anchored in a single
 * timezone (use the org's primary/property tz) so a payment is bucketed the same
 * way the income summary buckets it.
 */
export interface MonthWindow {
  /** Inclusive start instant. */
  start: Date;
  /** Exclusive end instant (start of the following month). */
  end: Date;
  /** "yyyy-MM" label, for display/debugging. */
  key: string;
}

export interface CollectedWindows {
  currentMonth: MonthWindow;
  priorMonth: MonthWindow;
  sameMonthLastYear: MonthWindow;
}

function monthWindow(anchor: DateTime): MonthWindow {
  const start = anchor.startOf("month");
  return {
    start: start.toJSDate(),
    end: start.plus({ months: 1 }).toJSDate(),
    key: start.toFormat("yyyy-MM"),
  };
}

export function collectedWindows(now: Date, tz: string): CollectedWindows {
  const anchor = DateTime.fromJSDate(now, { zone: tz });
  return {
    currentMonth: monthWindow(anchor),
    priorMonth: monthWindow(anchor.minus({ months: 1 })),
    sameMonthLastYear: monthWindow(anchor.minus({ years: 1 })),
  };
}
