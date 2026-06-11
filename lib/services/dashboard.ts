import { prisma } from "@/lib/db";
import { sumCents } from "@/lib/money";
import { leaseSnapshot, type LeaseSnapshot } from "@/lib/services/accounting";
import type { AccountStatus } from "@/lib/accounting";
import { expectedMonthlyChargeCents } from "@/lib/accounting/rent";

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
  const [units, leases, monthAgg, todayAgg, recent] = await Promise.all([
    prisma.unit.groupBy({
      by: ["occupancyStatus"],
      where: unitWhere,
      _count: true,
    }),
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

  const occupiedUnits =
    units.find((u) => u.occupancyStatus === "occupied")?._count ?? 0;
  const vacantUnits = units
    .filter((u) => u.occupancyStatus !== "occupied")
    .reduce((s, u) => s + (typeof u._count === "number" ? u._count : 0), 0);

  const snapshots: { lease: (typeof leases)[number]; snap: LeaseSnapshot }[] = [];
  for (const lease of leases) {
    const snap = await leaseSnapshot(
      lease,
      lease.unit,
      now,
      lease.unit.property.timezone,
    );
    snapshots.push({ lease, snap });
  }

  const leaseRows: DashboardLeaseRow[] = snapshots.map(({ lease, snap }) => ({
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
  }));

  const overdueBalanceCents = sumCents(leaseRows.map((r) => r.pastDueCents));
  const overdueTenants = leaseRows.filter((r) => r.status === "overdue").length;
  const monthExpectedCents = sumCents(
    leases.map((l) =>
      expectedMonthlyChargeCents({ rentAmountCents: l.rentAmountCents, ...l.unit }),
    ),
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
