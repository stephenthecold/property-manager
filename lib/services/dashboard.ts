import { prisma } from "@/lib/db";
import { sumCents } from "@/lib/money";
import { batchLeaseSnapshots } from "@/lib/services/accounting";
import type { AccountStatus } from "@/lib/accounting";
import { expectedMonthlyChargeCents } from "@/lib/accounting/rent";
import { compareVacancy, computeVacancy } from "@/lib/units/vacancy";

export interface DashboardLeaseRow {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  unitLabel: string;
  propertyName: string;
  status: AccountStatus;
  netBalanceCents: bigint;
  pastDueCents: bigint;
  lastPaymentDays: number | null;
  /** Expected monthly charge — prefills the quick "Collect" dialog. */
  monthlyChargeCents: bigint;
}

export interface DashboardData {
  monthExpectedCents: bigint;
  monthCollectedCents: bigint;
  todayCollectedCents: bigint;
  overdueBalanceCents: bigint;
  overdueTenants: number;
  occupiedUnits: number;
  vacantUnits: number;
  leaseRows: DashboardLeaseRow[];
  recentPayments: {
    id: string;
    tenantName: string;
    amountCents: bigint;
    paymentDate: Date;
    method: string;
  }[];
}

export interface VacancyRow {
  unitId: string;
  unitLabel: string;
  propertyName: string;
  /** Property timezone, for date-only formatting of availableOn. */
  timezone: string;
  buildingName: string | null;
  /** Display state (vacant | upcoming | maintenance | unavailable | occupied). */
  state: "vacant" | "upcoming" | "occupied" | "maintenance" | "unavailable";
  /** Available right now (currently not occupied). */
  availableNow: boolean;
  /** Future availability date, or null when availableNow. */
  availableOn: Date | null;
  /** Current tenant for an upcoming (still-occupied) vacancy; null otherwise. */
  currentTenantName: string | null;
  /** Default/asking rent for the unit. */
  rentCents: bigint;
}

/**
 * Units that are vacant now or have a known upcoming vacancy, soonest first.
 * Bridges Prisma → the pure `computeVacancy`; never re-implements the logic.
 */
export async function getVacancyOutlook(
  now: Date,
  propertyId?: string,
): Promise<VacancyRow[]> {
  const units = await prisma.unit.findMany({
    where: propertyId ? { propertyId } : {},
    include: {
      property: { select: { name: true, timezone: true } },
      building: { select: { name: true } },
      leases: {
        where: { status: { in: ["active", "month_to_month"] } },
        select: { endDate: true, tenant: { select: { firstName: true, lastName: true } } },
        orderBy: { startDate: "desc" },
        take: 1,
      },
    },
  });

  return units
    .map((u) => {
      const lease = u.leases[0] ?? null;
      const vac = computeVacancy(
        {
          serviceStatus: u.serviceStatus,
          availableFromDate: u.availableFromDate,
          activeLeaseEndDate: lease?.endDate ?? null,
          hasActiveLease: !!lease,
        },
        now,
      );
      return { u, lease, vac };
    })
    .filter(({ vac }) => vac.listed)
    .sort((a, b) => compareVacancy(a.vac, b.vac))
    .map(({ u, lease, vac }) => ({
      unitId: u.id,
      unitLabel: u.unitNumber,
      propertyName: u.property.name,
      timezone: u.property.timezone,
      buildingName: u.building?.name ?? null,
      state: vac.state,
      availableNow: vac.availableNow,
      availableOn: vac.availableOn,
      currentTenantName:
        vac.state === "upcoming" && lease?.tenant
          ? `${lease.tenant.firstName} ${lease.tenant.lastName}`
          : null,
      rentCents: u.defaultRentAmountCents,
    }));
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
function dayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export async function getDashboard(
  now: Date,
  propertyId?: string,
): Promise<DashboardData> {
  const unitWhere = propertyId ? { propertyId } : {};
  const [totalUnits, leases, monthAgg, todayAgg, recent] = await Promise.all([
    prisma.unit.count({ where: unitWhere }),
    prisma.lease.findMany({
      where: {
        status: { in: ["active", "month_to_month"] },
        ...(propertyId ? { unit: { propertyId } } : {}),
      },
      include: { tenant: true, unit: { include: { property: true } } },
    }),
    prisma.payment.aggregate({
      _sum: { amountCents: true },
      where: {
        status: "posted",
        paymentDate: { gte: monthStart(now) },
        ...(propertyId ? { propertyId } : {}),
      },
    }),
    prisma.payment.aggregate({
      _sum: { amountCents: true },
      where: {
        status: "posted",
        paymentDate: { gte: dayStart(now) },
        ...(propertyId ? { propertyId } : {}),
      },
    }),
    prisma.payment.findMany({
      where: { status: "posted", ...(propertyId ? { propertyId } : {}) },
      orderBy: { paymentDate: "desc" },
      take: 8,
      include: { lease: { include: { tenant: true } } },
    }),
  ]);

  // Occupancy is lease-derived: a unit is occupied iff it has an active lease.
  const occupiedUnits = new Set(leases.map((l) => l.unitId)).size;
  const vacantUnits = Math.max(0, totalUnits - occupiedUnits);

  const snaps = await batchLeaseSnapshots(leases, now);

  const leaseRows: DashboardLeaseRow[] = leases.map((lease) => {
    const snap = snaps.get(lease.id)!;
    return {
      leaseId: lease.id,
      tenantId: lease.tenantId,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      unitLabel: lease.unit.unitNumber,
      propertyName: lease.unit.property.name,
      status: snap.status,
      netBalanceCents: snap.netBalanceCents,
      pastDueCents:
        snap.aging.d1_30 +
        snap.aging.d31_60 +
        snap.aging.d61_90 +
        snap.aging.d90plus,
      lastPaymentDays: snap.daysSinceLastPayment,
      monthlyChargeCents: expectedMonthlyChargeCents(lease),
    };
  });

  const overdueBalanceCents = sumCents(leaseRows.map((r) => r.pastDueCents));
  const overdueTenants = leaseRows.filter((r) => r.status === "overdue").length;
  const monthExpectedCents = sumCents(
    leases.map((l) => expectedMonthlyChargeCents(l)),
  );

  return {
    monthExpectedCents,
    monthCollectedCents: monthAgg._sum.amountCents ?? 0n,
    todayCollectedCents: todayAgg._sum.amountCents ?? 0n,
    overdueBalanceCents,
    overdueTenants,
    occupiedUnits,
    vacantUnits,
    leaseRows,
    recentPayments: recent.map((p) => ({
      id: p.id,
      tenantName: `${p.lease.tenant.firstName} ${p.lease.tenant.lastName}`,
      amountCents: p.amountCents,
      paymentDate: p.paymentDate,
      method: p.method,
    })),
  };
}
