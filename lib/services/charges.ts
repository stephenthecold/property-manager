import { prisma } from "@/lib/db";
import { fromCents } from "@/lib/money";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  type ChargeInput,
  computeOpenCharges,
  netReversalsIntoCharges,
  planFifoAllocation,
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

export interface WriteOffResult {
  /** Primary tenant of the lease — for path revalidation. */
  tenantId: string;
  /** Total amount forgiven (sum of every open charge's outstanding). */
  writtenOffCents: bigint;
  /** How many open charges were reversed. */
  chargesAffected: number;
}

/**
 * Write off (forgive) a lease's outstanding balance as bad debt — the back-rent
 * case for a terminated lease that won't be collected. Forgives exactly the NET
 * owed (`max(0, balance)`), NOT the gross open charges: any standing tenant
 * credit already offsets the charges, so forgiving the gross would push the
 * balance negative and manufacture a phantom credit. The net is distributed
 * oldest-first with the same FIFO logic payments use, appending one offsetting
 * `reversal` per charge (the SAME append-only mechanism as {@link waiveCharge}),
 * so aging, overdue reminders, FIFO allocation, and late-fee accrual all see it
 * as settled and the balance lands at exactly 0. Originals are never mutated or
 * deleted. A lease with no net owed (zero balance or a credit) throws, as does
 * a second call once the balance is already 0.
 */
export async function writeOffLeaseBalance(input: {
  leaseId: string;
  reason: string;
  actor: AuditContext;
}): Promise<WriteOffResult> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A reason is required to write off a balance.");

  return prisma.$transaction(async (tx) => {
    const lease = await tx.lease.findUnique({
      where: { id: input.leaseId },
      select: { id: true, tenantId: true },
    });
    if (!lease) throw new Error("Lease not found.");

    // Open charges + current outstanding, computed with the same pure netting
    // every loader uses (prior reversals net in, active allocations net out),
    // plus the net balance (SUM over ALL entries — the ledger's owed invariant).
    const [chargeRows, reversals, allocations, balanceAgg] = await Promise.all([
      tx.ledgerEntry.findMany({
        where: {
          leaseId: lease.id,
          OR: [
            { entryType: { in: ["rent_charge", "late_fee"] } },
            { entryType: "adjustment", amountCents: { gt: 0n } },
          ],
        },
        select: { id: true, amountCents: true, effectiveDate: true, periodKey: true },
      }),
      tx.ledgerEntry.findMany({
        where: { leaseId: lease.id, entryType: "reversal", reversesEntryId: { not: null } },
        select: { amountCents: true, reversesEntryId: true },
      }),
      tx.chargeAllocation.findMany({
        where: { chargeEntry: { leaseId: lease.id } },
        select: { id: true, chargeEntryId: true, reversesAllocationId: true, amountCents: true },
      }),
      tx.ledgerEntry.aggregate({
        where: { leaseId: lease.id },
        _sum: { amountCents: true },
      }),
    ]);

    const charges: ChargeInput[] = chargeRows.map((c) => ({
      entryId: c.id,
      amountCents: c.amountCents,
      dueDate: c.effectiveDate,
    }));
    const reversedAllocIds = new Set(
      allocations.map((a) => a.reversesAllocationId).filter((x): x is string => !!x),
    );
    const allocatedByCharge: Record<string, bigint> = {};
    for (const a of allocations) {
      if (a.reversesAllocationId) continue; // it's a reversing row
      if (reversedAllocIds.has(a.id)) continue; // it was reversed
      allocatedByCharge[a.chargeEntryId] =
        (allocatedByCharge[a.chargeEntryId] ?? 0n) + a.amountCents;
    }
    const open = computeOpenCharges(
      netReversalsIntoCharges(charges, reversals),
      allocatedByCharge,
    );
    const periodByEntry = new Map(chargeRows.map((c) => [c.id, c.periodKey] as const));

    // Forgive only the NET owed, distributed oldest-first across open charges
    // (FIFO, exactly like a payment). With net <= gross-open this consumes the
    // owed amount before running out of charges, so the balance lands at 0 and
    // never goes negative — a standing credit can't become a phantom credit.
    const netBalanceCents = balanceAgg._sum.amountCents ?? 0n;
    const owedCents = netBalanceCents > 0n ? netBalanceCents : 0n;
    if (owedCents <= 0n) {
      throw new Error("This lease has no outstanding balance to write off.");
    }
    const plan = planFifoAllocation(owedCents, open);
    for (const line of plan.allocations) {
      await tx.ledgerEntry.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          entryType: "reversal",
          amountCents: -line.amountCents,
          // Reversal rows are never covered by the rent_charge|late_fee partial
          // unique indexes, so copying the source period key is safe.
          periodKey: periodByEntry.get(line.chargeEntryId) ?? null,
          effectiveDate: new Date(),
          sourceType: "writeoff",
          reversesEntryId: line.chargeEntryId,
          reason,
          createdBy: input.actor.actorId ?? null,
          description: "Balance written off",
        },
      });
    }
    const writtenOffCents = owedCents - plan.leftoverCents;

    await writeAudit(tx, {
      ...input.actor,
      action: "lease.balance_written_off",
      entityType: "Lease",
      entityId: lease.id,
      after: {
        writtenOffCents: writtenOffCents.toString(),
        chargesAffected: plan.allocations.length,
        reason,
      },
    });

    return {
      tenantId: lease.tenantId,
      writtenOffCents,
      chargesAffected: plan.allocations.length,
    };
  });
}
