import { prisma } from "@/lib/db";
import {
  collectedWindows,
  compareCollected,
  computeOccupancy,
  computeTurnoverCost,
  computeVacancyLoss,
  type CollectedComparison,
  type Occupancy,
  type TurnoverCost,
  type VacancyLoss,
  type VacantUnitInput,
} from "@/lib/accounting/kpis";

/**
 * Operating-KPI bridge: loads Prisma rows and calls the pure compute in
 * lib/accounting/kpis.ts (DB-free, unit-tested). Mirrors lib/services/dashboard.ts
 * — this layer only fetches + maps; it re-implements no math. Reads are batched
 * (a handful of aggregates / one findMany), never N+1.
 *
 * Occupancy is lease-derived (a unit is occupied iff it has an active or
 * month_to_month lease); off-market units (serviceStatus "unavailable") are
 * excluded from the rentable denominator — matching lib/units/vacancy.ts.
 */

export interface DashboardKpis {
  occupancy: Occupancy;
  vacancyLoss: VacancyLoss;
}

import type { LeaseStatus } from "@/lib/generated/prisma/enums";

const ACTIVE_STATUSES: LeaseStatus[] = ["active", "month_to_month"];
const ENDED_STATUSES: LeaseStatus[] = ["ended", "eviction"];

/**
 * Occupancy % and estimated vacant-day lost rent, as of `now`. One pass over the
 * units (with their active flag, off-market flag, and last-ended-lease end date)
 * feeds both pure functions. `lostRentLookbackDays` caps a long-idle/never-leased
 * unit's contribution (default 365).
 */
export async function getDashboardKpis(
  now: Date,
  opts: { propertyId?: string; lostRentLookbackDays?: number } = {},
): Promise<DashboardKpis> {
  const unitWhere = opts.propertyId ? { propertyId: opts.propertyId } : {};
  const units = await prisma.unit.findMany({
    where: unitWhere,
    select: {
      id: true,
      createdAt: true,
      serviceStatus: true,
      defaultRentAmountCents: true,
      property: { select: { timezone: true } },
      // Is the unit currently leased? (active/month_to_month)
      leases: {
        where: { status: { in: ACTIVE_STATUSES } },
        select: { id: true },
        take: 1,
      },
    },
  });

  // Most-recent ended-lease endDate per unit, in ONE query (avoids N+1).
  const unitIds = units.map((u) => u.id);
  const endedLeases = unitIds.length
    ? await prisma.lease.findMany({
        where: { unitId: { in: unitIds }, status: { in: ENDED_STATUSES }, endDate: { not: null } },
        select: { unitId: true, endDate: true },
        orderBy: { endDate: "desc" },
      })
    : [];
  const lastEndByUnit = new Map<string, Date>();
  for (const l of endedLeases) {
    // desc order → first seen per unit is the most recent.
    if (l.endDate && !lastEndByUnit.has(l.unitId)) {
      lastEndByUnit.set(l.unitId, l.endDate);
    }
  }

  let occupiedUnits = 0;
  let unavailableUnits = 0;
  const vacantInputs: VacantUnitInput[] = [];
  for (const u of units) {
    const occupied = u.leases.length > 0;
    if (occupied) {
      occupiedUnits += 1;
      continue;
    }
    if (u.serviceStatus === "unavailable") {
      // Off-market: excluded from BOTH occupancy denominator and vacancy loss.
      unavailableUnits += 1;
      continue;
    }
    // Not leased and on the market → a vacancy that loses rent. "Vacant since" =
    // most recent ended lease's endDate, else the unit's own createdAt.
    vacantInputs.push({
      tz: u.property.timezone,
      vacantSince: lastEndByUnit.get(u.id) ?? u.createdAt,
      marketRentCents: u.defaultRentAmountCents,
    });
  }

  return {
    occupancy: computeOccupancy({
      occupiedUnits,
      totalUnits: units.length,
      unavailableUnits,
    }),
    vacancyLoss: computeVacancyLoss(
      vacantInputs,
      now,
      opts.lostRentLookbackDays ?? 365,
    ),
  };
}

/**
 * Turnover cost over [from, to): finalized move-out deposit-disposition damages
 * PLUS turnover operating expenses (PropertyExpense, category "maintenance",
 * attributed to a specific unit — whole-property/building expenses aren't
 * turnover). Both streams are summed in the DB; the pure function just adds them.
 */
export async function getTurnoverCost(
  range: { from: Date; to: Date },
  propertyId?: string,
): Promise<TurnoverCost> {
  const [dispositionAgg, expenseAgg] = await Promise.all([
    prisma.depositDisposition.aggregate({
      _sum: { damagesTotalCents: true },
      where: {
        status: "finalized",
        finalizedAt: { gte: range.from, lt: range.to },
        ...(propertyId
          ? { lease: { unit: { propertyId } } }
          : {}),
      },
    }),
    prisma.propertyExpense.aggregate({
      _sum: { amountCents: true },
      where: {
        category: "maintenance",
        // Turnover work is unit-specific; whole-property maintenance is excluded.
        unitId: { not: null },
        incurredOn: { gte: range.from, lt: range.to },
        ...(propertyId ? { propertyId } : {}),
      },
    }),
  ]);
  return computeTurnoverCost({
    moveOutDamagesCents: dispositionAgg._sum.damagesTotalCents ?? 0n,
    turnoverExpensesCents: expenseAgg._sum.amountCents ?? 0n,
  });
}

export interface CollectedTrend extends CollectedComparison {
  currentMonthKey: string;
  priorMonthKey: string;
  sameMonthLastYearKey: string;
}

/**
 * Period-over-period on COLLECTED cash (posted payments): this month vs last
 * month, and this month vs the same month a year ago. Month windows are anchored
 * in `tz` (pass the org defaultTimezone) so a payment buckets the same way the
 * income summary buckets it. Three indexed range aggregates, run in parallel.
 *
 * Collected is returned in the operator's POSITIVE convention (a Payment row's
 * amountCents is already positive cash in; the ledger's negative-payment sign
 * lives only in LedgerEntry).
 */
export async function getCollectedTrend(
  now: Date,
  tz: string,
  propertyId?: string,
): Promise<CollectedTrend> {
  const w = collectedWindows(now, tz);
  const sumPosted = (start: Date, end: Date) =>
    prisma.payment.aggregate({
      _sum: { amountCents: true },
      where: {
        status: "posted",
        paymentDate: { gte: start, lt: end },
        ...(propertyId ? { propertyId } : {}),
      },
    });
  const [cur, prior, lastYear] = await Promise.all([
    sumPosted(w.currentMonth.start, w.currentMonth.end),
    sumPosted(w.priorMonth.start, w.priorMonth.end),
    sumPosted(w.sameMonthLastYear.start, w.sameMonthLastYear.end),
  ]);
  const comparison = compareCollected({
    currentMonthCents: cur._sum.amountCents ?? 0n,
    priorMonthCents: prior._sum.amountCents ?? 0n,
    sameMonthLastYearCents: lastYear._sum.amountCents ?? 0n,
  });
  return {
    ...comparison,
    currentMonthKey: w.currentMonth.key,
    priorMonthKey: w.priorMonth.key,
    sameMonthLastYearKey: w.sameMonthLastYear.key,
  };
}
