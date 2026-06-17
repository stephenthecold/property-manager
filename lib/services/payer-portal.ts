import { prisma } from "@/lib/db";
import { sumCents } from "@/lib/money";
import { sharesEffectiveAt, type RentShareInput } from "@/lib/accounting/rent-shares";

/**
 * Read-only data for the payer portal, scoped to ONE payer. Shows the leases
 * this payer is expected to pay toward (they have a RentShare), what's expected
 * (their effective shares), what they've paid this month, and their recent
 * payments. Every query is keyed by the authenticated payerId — a payer can
 * only ever see their own attribution, never tenant balances or other payers.
 */

function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface PayerPortalLeaseRow {
  leaseId: string;
  tenantName: string;
  unitLabel: string;
  propertyName: string;
  currency: string;
  expectedCents: bigint;
  receivedThisMonthCents: bigint;
  shareLabels: string[];
}

export interface PayerPortalPaymentRow {
  id: string;
  date: Date;
  amountCents: bigint;
  method: string;
  currency: string;
  tenantName: string;
  unitLabel: string;
  reference: string | null;
}

export interface PayerPortalView {
  leases: PayerPortalLeaseRow[];
  recentPayments: PayerPortalPaymentRow[];
  totalExpectedCents: bigint;
  totalReceivedThisMonthCents: bigint;
}

export async function getPayerPortalView(
  payerId: string,
  now: Date,
): Promise<PayerPortalView> {
  const since = monthStartUtc(now);

  const leases = await prisma.lease.findMany({
    where: {
      status: { in: ["active", "month_to_month"] },
      rentShares: { some: { payerId } },
    },
    include: {
      tenant: { select: { firstName: true, lastName: true } },
      unit: { include: { property: { select: { name: true, currency: true } } } },
      // Only THIS payer's shares — never another party's split.
      rentShares: { where: { payerId } },
    },
    orderBy: [
      { unit: { property: { name: "asc" } } },
      { unit: { unitNumber: "asc" } },
    ],
  });

  const grouped =
    leases.length > 0
      ? await prisma.payment.groupBy({
          by: ["leaseId"],
          where: {
            payerId,
            leaseId: { in: leases.map((l) => l.id) },
            status: "posted",
            paymentDate: { gte: since },
          },
          _sum: { amountCents: true },
        })
      : [];
  const receivedByLease = new Map(
    grouped.map((g) => [g.leaseId, g._sum.amountCents ?? 0n]),
  );

  const leaseRows: PayerPortalLeaseRow[] = leases.map((lease) => {
    const effective: RentShareInput[] = sharesEffectiveAt(
      lease.rentShares.map((s) => ({
        payerId: s.payerId,
        label: s.label,
        amountCents: s.amountCents,
        effectiveDate: s.effectiveDate,
        endDate: s.endDate,
      })),
      now,
    );
    return {
      leaseId: lease.id,
      tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
      unitLabel: lease.unit.unitNumber,
      propertyName: lease.unit.property.name,
      currency: lease.unit.property.currency,
      expectedCents: sumCents(effective.map((s) => s.amountCents)),
      receivedThisMonthCents: receivedByLease.get(lease.id) ?? 0n,
      shareLabels: effective.map((s) => s.label),
    };
  });

  const recent = await prisma.payment.findMany({
    where: { payerId, status: "posted" },
    orderBy: { paymentDate: "desc" },
    take: 20,
    include: {
      lease: {
        include: {
          tenant: { select: { firstName: true, lastName: true } },
          unit: { select: { unitNumber: true, property: { select: { currency: true } } } },
        },
      },
    },
  });

  return {
    leases: leaseRows,
    recentPayments: recent.map((p) => ({
      id: p.id,
      date: p.paymentDate,
      amountCents: p.amountCents,
      method: p.method,
      currency: p.lease.unit.property.currency,
      tenantName: `${p.lease.tenant.firstName} ${p.lease.tenant.lastName}`,
      unitLabel: p.lease.unit.unitNumber,
      reference: p.referenceNumber,
    })),
    totalExpectedCents: sumCents(leaseRows.map((r) => r.expectedCents)),
    totalReceivedThisMonthCents: sumCents(
      leaseRows.map((r) => r.receivedThisMonthCents),
    ),
  };
}
