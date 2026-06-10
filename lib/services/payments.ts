import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import type { Tx } from "@/lib/audit/audit";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  type OpenCharge,
  planFifoAllocation,
} from "@/lib/accounting/allocation";

/**
 * Record a payment: one interactive transaction creates the Payment row, its
 * negative ledger entry, and the FIFO allocations atomically. A client-minted
 * idempotencyKey (UNIQUE) makes double-submits a no-op.
 */
export interface PostPaymentInput {
  leaseId: string;
  amountCents: bigint;
  paymentDate: Date;
  method: PaymentMethod;
  referenceNumber?: string | null;
  notes?: string | null;
  appliedPeriodKey?: string | null;
  idempotencyKey: string;
  actor: AuditContext;
}

async function loadOpenChargesTx(
  tx: Tx,
  leaseId: string,
): Promise<OpenCharge[]> {
  const charges = await tx.ledgerEntry.findMany({
    where: {
      leaseId,
      entryType: { in: ["rent_charge", "late_fee"] },
    },
  });
  const allocations = await tx.chargeAllocation.findMany({
    where: { chargeEntry: { leaseId } },
  });
  const reversedIds = new Set(
    allocations.map((a) => a.reversesAllocationId).filter((x): x is string => !!x),
  );
  const allocatedByCharge: Record<string, bigint> = {};
  for (const a of allocations) {
    if (a.reversesAllocationId) continue;
    if (reversedIds.has(a.id)) continue;
    allocatedByCharge[a.chargeEntryId] =
      (allocatedByCharge[a.chargeEntryId] ?? 0n) + a.amountCents;
  }
  return charges
    .map((c) => ({
      entryId: c.id,
      dueDate: c.effectiveDate,
      outstandingCents: c.amountCents - (allocatedByCharge[c.id] ?? 0n),
    }))
    .filter((c) => c.outstandingCents > 0n)
    .sort((a, b) => {
      const t = a.dueDate.getTime() - b.dueDate.getTime();
      return t !== 0 ? t : a.entryId.localeCompare(b.entryId);
    });
}

export interface PostPaymentResult {
  paymentId: string;
  alreadyExisted: boolean;
  leftoverCreditCents: bigint;
}

export async function postPayment(
  input: PostPaymentInput,
): Promise<PostPaymentResult> {
  // Idempotency fast-path.
  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    return { paymentId: existing.id, alreadyExisted: true, leftoverCreditCents: 0n };
  }

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    include: { unit: true },
  });
  if (!lease) throw new Error("Lease not found");

  try {
    return await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          unitId: lease.unitId,
          propertyId: lease.unit.propertyId,
          buildingId: lease.unit.buildingId,
          paymentDate: input.paymentDate,
          amountCents: input.amountCents,
          method: input.method,
          referenceNumber: input.referenceNumber ?? null,
          status: "posted",
          appliedPeriodKey: input.appliedPeriodKey ?? null,
          idempotencyKey: input.idempotencyKey,
          notes: input.notes ?? null,
          createdBy: input.actor.actorId ?? null,
        },
      });

      const paymentEntry = await tx.ledgerEntry.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          entryType: "payment",
          amountCents: -input.amountCents, // payments reduce what is owed
          currency: lease.unit ? "USD" : "USD",
          periodKey: input.appliedPeriodKey ?? null,
          effectiveDate: input.paymentDate,
          sourceType: "payment",
          sourceId: payment.id,
          createdBy: input.actor.actorId ?? null,
          description: "Payment received",
        },
      });

      const open = await loadOpenChargesTx(tx, lease.id);
      const plan = planFifoAllocation(input.amountCents, open);
      for (const line of plan.allocations) {
        await tx.chargeAllocation.create({
          data: {
            chargeEntryId: line.chargeEntryId,
            paymentEntryId: paymentEntry.id,
            amountCents: line.amountCents,
          },
        });
      }

      await writeAudit(tx, {
        ...input.actor,
        action: "payment.posted",
        entityType: "Payment",
        entityId: payment.id,
        after: {
          amountCents: input.amountCents.toString(),
          method: input.method,
          leftoverCreditCents: plan.leftoverCents.toString(),
        },
      });

      return {
        paymentId: payment.id,
        alreadyExisted: false,
        leftoverCreditCents: plan.leftoverCents,
      };
    });
  } catch (e) {
    // Lost the idempotency race: another request created it first.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (dup) {
        return { paymentId: dup.id, alreadyExisted: true, leftoverCreditCents: 0n };
      }
    }
    throw e;
  }
}

/**
 * Void a posted payment: append an offsetting reversal entry + reversing
 * allocations (never delete), and mark the payment voided. Balance self-corrects.
 */
export async function voidPayment(input: {
  paymentId: string;
  reason: string;
  actor: AuditContext;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
    });
    if (!payment) throw new Error("Payment not found");
    if (payment.status !== "posted") {
      throw new Error(`Cannot void a payment with status ${payment.status}`);
    }

    const paymentEntry = await tx.ledgerEntry.findFirst({
      where: { sourceType: "payment", sourceId: payment.id, entryType: "payment" },
    });
    if (!paymentEntry) throw new Error("Payment ledger entry missing");

    // Offsetting reversal entry (equal and opposite); original is retained.
    await tx.ledgerEntry.create({
      data: {
        leaseId: paymentEntry.leaseId,
        tenantId: paymentEntry.tenantId,
        entryType: "reversal",
        amountCents: -paymentEntry.amountCents,
        effectiveDate: new Date(),
        sourceType: "payment",
        sourceId: payment.id,
        reversesEntryId: paymentEntry.id,
        reason: input.reason,
        createdBy: input.actor.actorId ?? null,
        description: "Payment voided",
      },
    });

    // Unwind this payment's allocations with reversing rows.
    const allocations = await tx.chargeAllocation.findMany({
      where: { paymentEntryId: paymentEntry.id, reversesAllocationId: null },
    });
    for (const a of allocations) {
      await tx.chargeAllocation.create({
        data: {
          chargeEntryId: a.chargeEntryId,
          paymentEntryId: paymentEntry.id,
          amountCents: a.amountCents,
          reversesAllocationId: a.id,
        },
      });
    }

    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "voided" },
    });

    await writeAudit(tx, {
      ...input.actor,
      action: "payment.voided",
      entityType: "Payment",
      entityId: payment.id,
      before: { status: "posted" },
      after: { status: "voided", reason: input.reason },
    });
  });
}
