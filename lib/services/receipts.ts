import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type {
  Lease,
  Payment,
  Property,
  Receipt,
  Tenant,
  Unit,
} from "@/lib/generated/prisma/client";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  formatReceiptNumber,
  nextSequenceFromNumbers,
  receiptDateKey,
} from "@/lib/accounting/receipts";

/**
 * Digital receipts. One per payment, enforced by the raw-SQL partial unique
 * index (paymentId WHERE receiptType='digital'); receipt numbers are unique
 * per day via the receiptNumber UNIQUE. Both races resolve in the retry loop.
 */

export interface EnsureReceiptResult {
  receiptId: string;
  receiptNumber: string;
  created: boolean;
}

async function findDigitalReceipt(paymentId: string): Promise<Receipt | null> {
  return prisma.receipt.findFirst({
    where: { paymentId, receiptType: "digital" },
  });
}

export async function ensureReceiptForPayment(
  paymentId: string,
  actor: AuditContext,
): Promise<EnsureReceiptResult> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      lease: { include: { unit: { include: { property: true } } } },
    },
  });
  if (!payment) throw new Error(`Payment not found: ${paymentId}`);

  const existing = await findDigitalReceipt(paymentId);
  if (existing) {
    return {
      receiptId: existing.id,
      receiptNumber: existing.receiptNumber,
      created: false,
    };
  }

  const property = payment.lease.unit.property;
  const dateKey = receiptDateKey(payment.paymentDate, property.timezone);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const receipt = await prisma.$transaction(async (tx) => {
        const taken = await tx.receipt.findMany({
          where: { receiptNumber: { startsWith: `RCT-${dateKey}-` } },
          select: { receiptNumber: true },
        });
        const seq = nextSequenceFromNumbers(
          dateKey,
          taken.map((r) => r.receiptNumber),
        );
        const receiptNumber = formatReceiptNumber(dateKey, seq);

        // "Balance after payment" = SUM over all entries UP TO AND INCLUDING
        // this payment's ledger entry, in the same deterministic ordering the
        // ledger reports use (effectiveDate, createdAt, id). An unpinned sum
        // would drift whenever later activity exists at receipt-creation time
        // (idempotent replays, seed backfills, concurrent charges).
        const entries = await tx.ledgerEntry.findMany({
          where: { leaseId: payment.leaseId },
          select: {
            id: true,
            amountCents: true,
            effectiveDate: true,
            createdAt: true,
            sourceType: true,
            sourceId: true,
            entryType: true,
          },
          orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        });
        const paymentEntryIdx = entries.findIndex(
          (e) =>
            e.entryType === "payment" &&
            e.sourceType === "payment" &&
            e.sourceId === payment.id,
        );
        let balanceAfterCents = 0n;
        const upTo = paymentEntryIdx >= 0 ? paymentEntryIdx : entries.length - 1;
        for (let i = 0; i <= upTo; i++) balanceAfterCents += entries[i].amountCents;

        const created = await tx.receipt.create({
          data: {
            receiptNumber,
            receiptType: "digital",
            paymentId: payment.id,
            tenantId: payment.tenantId,
            unitId: payment.unitId ?? payment.lease.unitId,
            propertyId: payment.propertyId ?? property.id,
            amountCents: payment.amountCents,
            paymentDate: payment.paymentDate,
            paymentMethod: payment.method,
            balanceAfterCents,
            createdBy: actor.actorId ?? null,
          },
        });

        await writeAudit(tx, {
          ...actor,
          action: "receipt.created",
          entityType: "Receipt",
          entityId: created.id,
          after: { receiptNumber, paymentId: payment.id },
        });

        return created;
      });
      return {
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        created: true,
      };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        // Either unique can fire: digital-receipt-per-payment (a concurrent
        // caller won — return theirs) or receiptNumber (same-day sequence
        // race — recompute and retry).
        const winner = await findDigitalReceipt(paymentId);
        if (winner) {
          return {
            receiptId: winner.id,
            receiptNumber: winner.receiptNumber,
            created: false,
          };
        }
        continue;
      }
      throw e;
    }
  }
  throw new Error(
    `Could not allocate a receipt number for payment ${paymentId} after 5 attempts`,
  );
}

export interface ReceiptContext {
  receipt: Receipt;
  payment: Payment | null;
  tenant: Tenant | null;
  unit: Unit | null;
  property: Property | null;
  lease: Lease | null;
}

/** Receipt ids are loose (no FKs); each related row may be absent. */
export async function getReceiptWithContext(
  receiptId: string,
): Promise<ReceiptContext | null> {
  const receipt = await prisma.receipt.findUnique({ where: { id: receiptId } });
  if (!receipt) return null;

  const payment = receipt.paymentId
    ? await prisma.payment.findUnique({ where: { id: receipt.paymentId } })
    : null;
  const [tenant, unit, property, lease] = await Promise.all([
    receipt.tenantId
      ? prisma.tenant.findUnique({ where: { id: receipt.tenantId } })
      : null,
    receipt.unitId
      ? prisma.unit.findUnique({ where: { id: receipt.unitId } })
      : null,
    receipt.propertyId
      ? prisma.property.findUnique({ where: { id: receipt.propertyId } })
      : null,
    payment
      ? prisma.lease.findUnique({ where: { id: payment.leaseId } })
      : null,
  ]);

  return { receipt, payment, tenant, unit, property, lease };
}

export async function markReceiptSent(
  receiptId: string,
  method: "sms" | "email" | "printed",
  actor: AuditContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const receipt = await tx.receipt.findUnique({ where: { id: receiptId } });
    if (!receipt) throw new Error(`Receipt not found: ${receiptId}`);

    await tx.receipt.update({
      where: { id: receiptId },
      data: { sentAt: new Date(), sentMethod: method },
    });

    await writeAudit(tx, {
      ...actor,
      action: "receipt.sent",
      entityType: "Receipt",
      entityId: receiptId,
      before: { sentMethod: receipt.sentMethod, sentAt: receipt.sentAt },
      after: { sentMethod: method },
    });
  });
}
