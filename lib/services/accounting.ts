import { prisma } from "@/lib/db";
import {
  agingFromOpenCharges,
  type AgingBuckets,
  type ChargeInput,
  computeOpenCharges,
  type AllocatedByCharge,
  daysSinceLastPayment,
  deriveStatus,
  type AccountStatus,
  type LedgerEntryInput,
  netBalanceCents,
  tenantCreditCents,
  totalOwedCents,
} from "@/lib/accounting";
import type { Lease, Unit } from "@/lib/generated/prisma/client";

/**
 * Bridges Prisma rows to the pure accounting functions. The DB only loads data;
 * all money logic lives in lib/accounting and lib/money (single source of truth).
 */

export interface LeaseAccounting {
  entries: LedgerEntryInput[];
  charges: ChargeInput[];
  allocatedByCharge: AllocatedByCharge;
}

/** Load a lease's ledger entries + net FIFO allocations per charge. */
export async function loadLeaseAccounting(
  leaseId: string,
): Promise<LeaseAccounting> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { leaseId },
    orderBy: { effectiveDate: "asc" },
    include: { allocationsAsCharge: true },
  });

  const entries: LedgerEntryInput[] = rows.map((r) => ({
    id: r.id,
    entryType: r.entryType,
    amountCents: r.amountCents,
    effectiveDate: r.effectiveDate,
    periodKey: r.periodKey,
  }));

  const charges: ChargeInput[] = rows
    .filter(
      (r) =>
        r.entryType === "rent_charge" ||
        r.entryType === "late_fee" ||
        (r.entryType === "adjustment" && r.amountCents > 0n),
    )
    .map((r) => ({
      entryId: r.id,
      amountCents: r.amountCents,
      dueDate: r.effectiveDate,
    }));

  // Active (non-reversed, non-reversing) allocations summed per charge.
  const allAllocations = await prisma.chargeAllocation.findMany({
    where: { chargeEntry: { leaseId } },
  });
  const reversedIds = new Set(
    allAllocations
      .map((a) => a.reversesAllocationId)
      .filter((x): x is string => !!x),
  );
  const allocatedByCharge: AllocatedByCharge = {};
  for (const a of allAllocations) {
    if (a.reversesAllocationId) continue; // it's a reversing row
    if (reversedIds.has(a.id)) continue; // it was reversed
    allocatedByCharge[a.chargeEntryId] =
      (allocatedByCharge[a.chargeEntryId] ?? 0n) + a.amountCents;
  }

  return { entries, charges, allocatedByCharge };
}

export interface LeaseSnapshot {
  leaseId: string;
  status: AccountStatus;
  netBalanceCents: bigint;
  totalOwedCents: bigint;
  creditCents: bigint;
  aging: AgingBuckets;
  currentPeriodDueDate: Date | null;
  currentPeriodOutstandingCents: bigint;
  daysSinceLastPayment: number | null;
}

/** Full financial snapshot for a lease, given its unit (for occupancy/status). */
export async function leaseSnapshot(
  lease: Lease,
  unit: Pick<Unit, "occupancyStatus">,
  now: Date,
  tz: string,
): Promise<LeaseSnapshot> {
  const { entries, charges, allocatedByCharge } =
    await loadLeaseAccounting(lease.id);

  const open = computeOpenCharges(charges, allocatedByCharge);

  // Current period = most recent rent_charge.
  const rentCharges = entries
    .filter((e) => e.entryType === "rent_charge")
    .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
  const current = rentCharges[0] ?? null;
  const currentOutstanding = current
    ? (current.amountCents - (allocatedByCharge[current.id] ?? 0n))
    : 0n;
  const currentPaid = current ? (allocatedByCharge[current.id] ?? 0n) : 0n;

  const hasActiveLease =
    lease.status === "active" || lease.status === "month_to_month";

  const status = deriveStatus({
    occupancy: unit.occupancyStatus,
    hasActiveLease,
    currentPeriodOutstandingCents: currentOutstanding,
    currentPeriodPaidCents: currentPaid,
    currentPeriodDueDate: current?.effectiveDate ?? null,
    gracePeriodDays: lease.gracePeriodDays,
    tz,
    now,
  });

  return {
    leaseId: lease.id,
    status,
    netBalanceCents: netBalanceCents(entries),
    totalOwedCents: totalOwedCents(entries),
    creditCents: tenantCreditCents(entries),
    aging: agingFromOpenCharges(open, now, tz),
    currentPeriodDueDate: current?.effectiveDate ?? null,
    currentPeriodOutstandingCents: currentOutstanding,
    daysSinceLastPayment: daysSinceLastPayment(entries, now),
  };
}
