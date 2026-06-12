import { prisma } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  type ChargeInput,
  netReversalsIntoCharges,
} from "@/lib/accounting/allocation";

/**
 * Waive (void) part or all of a charge, append-only: an offsetting `reversal`
 * ledger entry pointing at the charge via `reversesEntryId`. Every reader nets
 * these reversals into the charge (`netReversalsIntoCharges`), so the waived
 * portion stops aging, overdue reminders, FIFO payment allocation, and daily
 * late-fee accrual. The original entry is never mutated or deleted; already-
 * assessed late fees stay and can be waived separately.
 */

export interface WaiveChargeInput {
  /** Ledger entry id of the charge being waived. */
  entryId: string;
  /** Positive amount to waive (<= the charge's current outstanding). */
  amountCents: bigint;
  reason: string;
  actor: AuditContext;
}

export interface WaiveChargeResult {
  leaseId: string;
  /** Primary tenant of the lease — for path revalidation. */
  tenantId: string;
  remainingOutstandingCents: bigint;
}

export async function waiveCharge(
  input: WaiveChargeInput,
): Promise<WaiveChargeResult> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required to waive a charge.");
  if (input.amountCents <= 0n) {
    throw new Error("Waive amount must be positive.");
  }

  return prisma.$transaction(async (tx) => {
    const entry = await tx.ledgerEntry.findUnique({
      where: { id: input.entryId },
      include: { lease: { select: { id: true, tenantId: true } } },
    });
    if (!entry) throw new Error("Charge not found.");
    const isCharge =
      entry.entryType === "rent_charge" ||
      entry.entryType === "late_fee" ||
      (entry.entryType === "adjustment" && entry.amountCents > 0n);
    if (!isCharge) {
      throw new Error(
        "Only rent charges, late fees, and positive adjustments can be waived.",
      );
    }

    // Current outstanding = original + prior reversals - active allocations,
    // computed with the same pure netting every loader uses.
    const [reversals, allocations] = await Promise.all([
      tx.ledgerEntry.findMany({
        where: { entryType: "reversal", reversesEntryId: entry.id },
        select: { amountCents: true, reversesEntryId: true },
      }),
      tx.chargeAllocation.findMany({
        where: { chargeEntryId: entry.id },
        select: { id: true, reversesAllocationId: true, amountCents: true },
      }),
    ]);
    const charge: ChargeInput = {
      entryId: entry.id,
      amountCents: entry.amountCents,
      dueDate: entry.effectiveDate,
    };
    const [netted] = netReversalsIntoCharges([charge], reversals);
    const reversedAllocIds = new Set(
      allocations
        .map((a) => a.reversesAllocationId)
        .filter((x): x is string => !!x),
    );
    let allocatedCents = 0n;
    for (const a of allocations) {
      if (a.reversesAllocationId) continue; // it's a reversing row
      if (reversedAllocIds.has(a.id)) continue; // it was reversed
      allocatedCents += a.amountCents;
    }
    const outstandingCents = netted.amountCents - allocatedCents;

    if (outstandingCents <= 0n) {
      throw new Error("This charge has no outstanding amount left to waive.");
    }
    if (input.amountCents > outstandingCents) {
      throw new Error(
        `Cannot waive more than the outstanding ${fromCents(outstandingCents)}.`,
      );
    }

    await tx.ledgerEntry.create({
      data: {
        leaseId: entry.leaseId,
        tenantId: entry.tenantId,
        entryType: "reversal",
        amountCents: -input.amountCents,
        // Safe to copy: the partial unique indexes only cover
        // rent_charge | late_fee, never reversal rows.
        periodKey: entry.periodKey,
        effectiveDate: new Date(),
        reversesEntryId: entry.id,
        reason,
        createdBy: input.actor.actorId ?? null,
        description: "Charge waived",
      },
    });

    const remainingOutstandingCents = outstandingCents - input.amountCents;
    await writeAudit(tx, {
      ...input.actor,
      action: "charge.waived",
      entityType: "LedgerEntry",
      entityId: entry.id,
      after: {
        waivedCents: input.amountCents.toString(),
        reason,
        remainingOutstandingCents: remainingOutstandingCents.toString(),
      },
    });

    return {
      leaseId: entry.lease.id,
      tenantId: entry.lease.tenantId,
      remainingOutstandingCents,
    };
  });
}
