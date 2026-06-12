import { prisma } from "@/lib/db";
import {
  agingFromOpenCharges,
  type AgingBuckets,
  type ChargeInput,
  type ChargeReversalInput,
  computeOpenCharges,
  type AllocatedByCharge,
  daysSinceLastPayment,
  deriveStatus,
  type AccountStatus,
  type LedgerEntryInput,
  netBalanceCents,
  netReversalsIntoCharges,
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
  const [rows, allAllocations] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { leaseId },
      orderBy: { effectiveDate: "asc" },
      select: {
        id: true,
        entryType: true,
        amountCents: true,
        effectiveDate: true,
        periodKey: true,
        reversesEntryId: true,
      },
    }),
    // Active (non-reversed, non-reversing) allocations summed per charge.
    prisma.chargeAllocation.findMany({
      where: { chargeEntry: { leaseId } },
      select: { id: true, chargeEntryId: true, reversesAllocationId: true, amountCents: true },
    }),
  ]);

  const entries: LedgerEntryInput[] = rows.map((r) => ({
    id: r.id,
    entryType: r.entryType,
    amountCents: r.amountCents,
    effectiveDate: r.effectiveDate,
    periodKey: r.periodKey,
  }));

  // Waiver reversals net into their target charges, so every consumer of the
  // open-charge math (aging, snapshots, reminders, late fees) sees the waived
  // portion as settled.
  const charges = netReversalsIntoCharges(
    chargesFromEntries(rows),
    chargeReversalsFromEntries(rows),
  );
  const allocatedByCharge = allocatedByChargeFrom(allAllocations);

  return { entries, charges, allocatedByCharge };
}

/** Charge rows (rent, late fees, positive adjustments) from raw ledger entries. */
function chargesFromEntries(
  rows: {
    id: string;
    entryType: string;
    amountCents: bigint;
    effectiveDate: Date;
  }[],
): ChargeInput[] {
  return rows
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
}

/**
 * Reversal rows that point at another entry (charge waives, payment voids).
 * `netReversalsIntoCharges` ignores ones whose target isn't a charge.
 */
function chargeReversalsFromEntries(
  rows: {
    entryType: string;
    amountCents: bigint;
    reversesEntryId: string | null;
  }[],
): ChargeReversalInput[] {
  return rows.filter(
    (r) => r.entryType === "reversal" && r.reversesEntryId != null,
  );
}

/** Sum active (non-reversed, non-reversing) allocations per charge entry. */
function allocatedByChargeFrom(
  allocs: { id: string; chargeEntryId: string; reversesAllocationId: string | null; amountCents: bigint }[],
): AllocatedByCharge {
  const reversedIds = new Set(
    allocs
      .map((a) => a.reversesAllocationId)
      .filter((x): x is string => !!x),
  );
  const allocatedByCharge: AllocatedByCharge = {};
  for (const a of allocs) {
    if (a.reversesAllocationId) continue; // it's a reversing row
    if (reversedIds.has(a.id)) continue; // it was reversed
    allocatedByCharge[a.chargeEntryId] =
      (allocatedByCharge[a.chargeEntryId] ?? 0n) + a.amountCents;
  }
  return allocatedByCharge;
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

/** Lease fields the snapshot status logic needs (subset of the Prisma row). */
type SnapshotLease = Pick<Lease, "id" | "status" | "gracePeriodDays">;

/** Full financial snapshot for a lease, given its unit (for occupancy/status). */
export async function leaseSnapshot(
  lease: Lease,
  unit: Pick<Unit, "occupancyStatus">,
  now: Date,
  tz: string,
): Promise<LeaseSnapshot> {
  const accounting = await loadLeaseAccounting(lease.id);
  return snapshotFromAccounting(lease, unit, now, tz, accounting);
}

/**
 * Snapshots for many leases in a fixed number of queries (two total, regardless
 * of lease count) instead of two per lease. Pure compute is shared with the
 * single-lease path so balance math stays identical.
 */
export async function batchLeaseSnapshots<
  L extends SnapshotLease & { unit: Pick<Unit, "occupancyStatus"> & { property: { timezone: string } } },
>(leases: L[], now: Date): Promise<Map<string, LeaseSnapshot>> {
  const result = new Map<string, LeaseSnapshot>();
  if (leases.length === 0) return result;
  const leaseIds = leases.map((l) => l.id);

  const [rows, allocs] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { leaseId: { in: leaseIds } },
      orderBy: { effectiveDate: "asc" },
      select: {
        id: true,
        leaseId: true,
        entryType: true,
        amountCents: true,
        effectiveDate: true,
        periodKey: true,
        reversesEntryId: true,
      },
    }),
    prisma.chargeAllocation.findMany({
      where: { chargeEntry: { leaseId: { in: leaseIds } } },
      select: {
        id: true,
        chargeEntryId: true,
        reversesAllocationId: true,
        amountCents: true,
        chargeEntry: { select: { leaseId: true } },
      },
    }),
  ]);

  const rowsByLease = new Map<string, typeof rows>();
  for (const r of rows) {
    (rowsByLease.get(r.leaseId) ?? rowsByLease.set(r.leaseId, []).get(r.leaseId)!).push(r);
  }
  const allocsByLease = new Map<string, typeof allocs>();
  for (const a of allocs) {
    const lid = a.chargeEntry.leaseId;
    (allocsByLease.get(lid) ?? allocsByLease.set(lid, []).get(lid)!).push(a);
  }

  for (const lease of leases) {
    const leaseRows = rowsByLease.get(lease.id) ?? [];
    const accounting: LeaseAccounting = {
      entries: leaseRows.map((r) => ({
        id: r.id,
        entryType: r.entryType,
        amountCents: r.amountCents,
        effectiveDate: r.effectiveDate,
        periodKey: r.periodKey,
      })),
      charges: netReversalsIntoCharges(
        chargesFromEntries(leaseRows),
        chargeReversalsFromEntries(leaseRows),
      ),
      allocatedByCharge: allocatedByChargeFrom(allocsByLease.get(lease.id) ?? []),
    };
    result.set(
      lease.id,
      snapshotFromAccounting(lease, lease.unit, now, lease.unit.property.timezone, accounting),
    );
  }
  return result;
}

/**
 * Pure snapshot computation from already-loaded accounting data. Exported so
 * pages that need the per-charge open amounts too (e.g. the tenant ledger's
 * Waive controls) can share one `loadLeaseAccounting` call.
 */
export function snapshotFromAccounting(
  lease: SnapshotLease,
  unit: Pick<Unit, "occupancyStatus">,
  now: Date,
  tz: string,
  { entries, charges, allocatedByCharge }: LeaseAccounting,
): LeaseSnapshot {
  const open = computeOpenCharges(charges, allocatedByCharge);

  // Current period = most recent rent_charge. Outstanding uses the EFFECTIVE
  // (waiver-netted) amount from `charges`, not the raw entry amount, so a
  // waived current charge reads as settled (status, reminders, dashboards).
  const effectiveAmountById = new Map(charges.map((c) => [c.entryId, c.amountCents]));
  const rentCharges = entries
    .filter((e) => e.entryType === "rent_charge")
    .sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
  const current = rentCharges[0] ?? null;
  const currentOutstanding = current
    ? (effectiveAmountById.get(current.id) ?? current.amountCents) -
      (allocatedByCharge[current.id] ?? 0n)
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
