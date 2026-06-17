import { prisma } from "@/lib/db";
import {
  payerKey,
  reconcileExpectations,
  sharesEffectiveAt,
  type RentShareInput,
} from "@/lib/accounting/rent-shares";

/**
 * Bridges RentShare rows to the pure rent-share logic. Rent shares are an
 * expectation overlay (who is expected to pay how much of the monthly rent);
 * they never touch the ledger. "Received this month" mirrors the dashboard's
 * collected figure (posted payments since the UTC month start), grouped by the
 * payer the payment was attributed to.
 */

/** UTC month start — matches the dashboard's "collected this month" window. */
function monthStartUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export interface LeaseRentShare {
  id: string;
  payerId: string | null;
  /** null = the tenant's portion. */
  payerName: string | null;
  label: string;
  amountCents: bigint;
  effectiveDate: Date;
  endDate: Date | null;
}

/** A lease's rent-split lines, newest effective first. */
export async function getLeaseRentShares(
  leaseId: string,
): Promise<LeaseRentShare[]> {
  const shares = await prisma.rentShare.findMany({
    where: { leaseId },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "asc" }],
    include: { payer: { select: { name: true } } },
  });
  return shares.map((s) => ({
    id: s.id,
    payerId: s.payerId,
    payerName: s.payer?.name ?? null,
    label: s.label,
    amountCents: s.amountCents,
    effectiveDate: s.effectiveDate,
    endDate: s.endDate,
  }));
}

export interface SubsidyExpectationRow {
  leaseId: string;
  tenantId: string;
  tenantName: string;
  unitLabel: string;
  propertyName: string;
  currency: string;
  payerId: string | null;
  /** "Tenant" or the payer's name. */
  payerName: string;
  expectedCents: bigint;
  receivedCents: bigint;
  missingCents: bigint;
}

/**
 * Per-payer expected-vs-received for the CURRENT month across every subsidized
 * lease (one with at least one rent share). `missingCents > 0` is an expected
 * portion that hasn't arrived — e.g. a housing authority's HAP. Two queries
 * total (leases + a grouped payment sum), no per-lease N+1.
 */
export async function getSubsidyExpectations(
  now: Date,
): Promise<SubsidyExpectationRow[]> {
  const since = monthStartUtc(now);

  const leases = await prisma.lease.findMany({
    where: {
      status: { in: ["active", "month_to_month"] },
      rentShares: { some: {} },
    },
    include: {
      tenant: { select: { firstName: true, lastName: true } },
      unit: { include: { property: { select: { name: true, currency: true } } } },
      rentShares: { include: { payer: { select: { id: true, name: true } } } },
    },
    orderBy: [
      { unit: { property: { name: "asc" } } },
      { unit: { unitNumber: "asc" } },
    ],
  });
  if (leases.length === 0) return [];

  const grouped = await prisma.payment.groupBy({
    by: ["leaseId", "payerId"],
    where: {
      leaseId: { in: leases.map((l) => l.id) },
      status: "posted",
      paymentDate: { gte: since },
    },
    _sum: { amountCents: true },
  });
  const receivedByLease = new Map<string, Map<string, bigint>>();
  for (const g of grouped) {
    const m = receivedByLease.get(g.leaseId) ?? new Map<string, bigint>();
    m.set(payerKey(g.payerId), g._sum.amountCents ?? 0n);
    receivedByLease.set(g.leaseId, m);
  }

  const rows: SubsidyExpectationRow[] = [];
  for (const lease of leases) {
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
    if (effective.length === 0) continue;

    const nameByPayer = new Map<string, string>();
    for (const s of lease.rentShares) {
      if (s.payer) nameByPayer.set(s.payer.id, s.payer.name);
    }

    const recon = reconcileExpectations(
      effective,
      receivedByLease.get(lease.id) ?? new Map(),
    );
    for (const r of recon) {
      rows.push({
        leaseId: lease.id,
        tenantId: lease.tenantId,
        tenantName: `${lease.tenant.firstName} ${lease.tenant.lastName}`,
        unitLabel: lease.unit.unitNumber,
        propertyName: lease.unit.property.name,
        currency: lease.unit.property.currency,
        payerId: r.payerId,
        payerName: r.payerId
          ? (nameByPayer.get(r.payerId) ?? "Payer")
          : "Tenant",
        expectedCents: r.expectedCents,
        receivedCents: r.receivedCents,
        missingCents: r.missingCents,
      });
    }
  }
  return rows;
}
