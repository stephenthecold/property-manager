import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import type { Tx } from "@/lib/audit/audit";
import { withAudit, writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  type OpenCharge,
  planFifoAllocation,
} from "@/lib/accounting/allocation";
import { ensureReceiptForPayment } from "@/lib/services/receipts";

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
  /** Non-tenant payer (e.g. a housing authority paying the HAP portion). null =
   * the tenant paid. Attribution only — never affects FIFO allocation. */
  payerId?: string | null;
  /** Captured inbound email this payment was recorded from (module "mailbox").
   * Attribution only — never affects allocation or balances. */
  sourceEmailId?: string | null;
  idempotencyKey: string;
  actor: AuditContext;
}

export async function loadOpenChargesTx(
  tx: Tx,
  leaseId: string,
): Promise<OpenCharge[]> {
  const [charges, reversals] = await Promise.all([
    tx.ledgerEntry.findMany({
      where: {
        leaseId,
        // Positive adjustments (e.g. opening balance on a backdated lease) are
        // charge-like and must receive FIFO allocations, matching the snapshot
        // logic in lib/services/accounting.ts.
        OR: [
          { entryType: { in: ["rent_charge", "late_fee"] } },
          { entryType: "adjustment", amountCents: { gt: 0 } },
        ],
      },
    }),
    // Waived portions (reversal entries targeting a charge) must not receive
    // FIFO allocations — same netting the snapshot/late-fee paths apply.
    tx.ledgerEntry.findMany({
      where: { leaseId, entryType: "reversal", reversesEntryId: { not: null } },
      select: { amountCents: true, reversesEntryId: true },
    }),
  ]);
  const reversedByCharge: Record<string, bigint> = {};
  for (const r of reversals) {
    if (!r.reversesEntryId) continue;
    reversedByCharge[r.reversesEntryId] =
      (reversedByCharge[r.reversesEntryId] ?? 0n) + r.amountCents;
  }
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
      // Reversal amounts are negative, so adding them shrinks the charge.
      outstandingCents:
        c.amountCents +
        (reversedByCharge[c.id] ?? 0n) -
        (allocatedByCharge[c.id] ?? 0n),
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
  // Idempotency fast-path. Also heals a missing receipt: a crash between the
  // payment commit and receipt creation would otherwise be permanent, since
  // every retry takes this path.
  const existing = await prisma.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (existing.status === "posted") await ensureReceiptBestEffort(existing.id, input.actor);
    return { paymentId: existing.id, alreadyExisted: true, leftoverCreditCents: 0n };
  }

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    include: { unit: true },
  });
  if (!lease) throw new Error("Lease not found");

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          unitId: lease.unitId,
          propertyId: lease.unit.propertyId,
          buildingId: lease.unit.buildingId,
          payerId: input.payerId ?? null,
          paymentDate: input.paymentDate,
          amountCents: input.amountCents,
          method: input.method,
          referenceNumber: input.referenceNumber ?? null,
          status: "posted",
          appliedPeriodKey: input.appliedPeriodKey ?? null,
          idempotencyKey: input.idempotencyKey,
          sourceEmailId: input.sourceEmailId ?? null,
          notes: input.notes ?? null,
          createdBy: input.actor.actorId ?? null,
        },
      });

      // The single posting path: negative `payment` ledger entry + FIFO
      // allocations + audit. Shared with confirmSelfReportedPayment so neither
      // re-implements allocation.
      const { leftoverCents } = await createPaymentLedgerTx(tx, {
        paymentId: payment.id,
        leaseId: lease.id,
        tenantId: lease.tenantId,
        amountCents: input.amountCents,
        paymentDate: input.paymentDate,
        appliedPeriodKey: input.appliedPeriodKey ?? null,
        method: input.method,
        payerId: input.payerId ?? null,
        actor: input.actor,
      });

      return {
        paymentId: payment.id,
        alreadyExisted: false,
        leftoverCreditCents: leftoverCents,
      };
    });

    // Best-effort after the payment commits: a receipt failure must never
    // fail or re-run the payment.
    await ensureReceiptBestEffort(result.paymentId, input.actor);

    return result;
  } catch (e) {
    // Lost the idempotency race: another request created it first.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const dup = await prisma.payment.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (dup) {
        await ensureReceiptBestEffort(dup.id, input.actor);
        return { paymentId: dup.id, alreadyExisted: true, leftoverCreditCents: 0n };
      }
    }
    throw e;
  }
}

/**
 * The ONE place a payment becomes balance-affecting: writes the negative
 * `payment` LedgerEntry, runs FIFO allocation against the lease's open charges,
 * persists the ChargeAllocation rows, and audits `payment.posted`. Must run
 * inside a transaction with the Payment row already created/marked posted.
 * Shared by postPayment (staff/gateway) and confirmSelfReportedPayment (tenant
 * self-report → confirm) so allocation is never duplicated.
 */
async function createPaymentLedgerTx(
  tx: Tx,
  args: {
    paymentId: string;
    leaseId: string;
    tenantId: string;
    amountCents: bigint;
    paymentDate: Date;
    appliedPeriodKey: string | null;
    method: PaymentMethod;
    payerId: string | null;
    actor: AuditContext;
  },
): Promise<{ leftoverCents: bigint }> {
  const paymentEntry = await tx.ledgerEntry.create({
    data: {
      leaseId: args.leaseId,
      tenantId: args.tenantId,
      entryType: "payment",
      amountCents: -args.amountCents, // payments reduce what is owed
      // Ledger currency follows the documented one-currency-per-property
      // simplification; display always reads property.currency.
      currency: "USD",
      periodKey: args.appliedPeriodKey,
      effectiveDate: args.paymentDate,
      sourceType: "payment",
      sourceId: args.paymentId,
      createdBy: args.actor.actorId ?? null,
      description: "Payment received",
    },
  });

  const open = await loadOpenChargesTx(tx, args.leaseId);
  const plan = planFifoAllocation(args.amountCents, open);
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
    ...args.actor,
    action: "payment.posted",
    entityType: "Payment",
    entityId: args.paymentId,
    after: {
      amountCents: args.amountCents.toString(),
      method: args.method,
      payerId: args.payerId,
      leftoverCreditCents: plan.leftoverCents.toString(),
    },
  });

  return { leftoverCents: plan.leftoverCents };
}

async function ensureReceiptBestEffort(
  paymentId: string,
  actor: AuditContext,
): Promise<void> {
  try {
    await ensureReceiptForPayment(paymentId, actor);
  } catch (receiptError) {
    console.warn(`Receipt creation failed for payment ${paymentId}`, receiptError);
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

    // CRITICAL double-reversal guard (mirrors confirmSelfReportedPayment). The
    // findUnique above is a lock-free read, so at READ COMMITTED two concurrent
    // voids (double-click / two staff / two tabs) could BOTH see status="posted"
    // and each append a reversal entry — double-reversing the payment and
    // corrupting the lease balance. This compare-and-swap takes the row lock and
    // only matches a still-posted row, so the loser updates 0 rows and bails
    // BEFORE any ledger write. It also performs the posted->voided flip, so the
    // trailing payment.update is no longer needed.
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "posted" },
      data: { status: "voided" },
    });
    if (claimed.count === 0) {
      throw new Error("Cannot void a payment that is already being voided.");
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

// ---------------------------------------------------------------------------
// Tenant self-report → staff-confirm (payments module).
//
// A tenant who paid offline (CashApp / cash / ACH) reports it from the portal.
// CRITICAL INVARIANT: a self-report creates a Payment with status="pending",
// reportedAt set, and NO LedgerEntry / NO ChargeAllocation — so it does NOT
// change the lease balance (balance = SUM(amountCents) over LedgerEntry rows;
// a pending Payment has no such row). Staff CONFIRM is the only step that posts
// (status="posted", confirmedAt/By, ledger entry + FIFO allocations via the
// SAME createPaymentLedgerTx as postPayment). REJECT marks it voided with no
// ledger touch. Both are idempotent: they re-read status inside the tx and only
// act on a still-pending row, so a double-confirm cannot double-post.
// ---------------------------------------------------------------------------

export interface ReportSelfPaymentInput {
  leaseId: string;
  amountCents: bigint;
  method: PaymentMethod;
  /** Tenant-entered reference (e.g. CashApp note / confirmation #). */
  referenceNumber?: string | null;
  notes?: string | null;
  /** When the tenant says they paid (defaults to now). */
  paymentDate?: Date;
  actor: AuditContext;
}

export interface ReportSelfPaymentResult {
  paymentId: string;
}

/**
 * Record a tenant-self-reported offline payment as PENDING. Writes ONLY the
 * Payment row — no ledger entry, no allocation — so the balance is untouched
 * until staff confirm. Audited as payment.self_reported. The caller (portal
 * action) is responsible for re-checking the portal session and that the tenant
 * is on the lease.
 */
export async function reportSelfPayment(
  input: ReportSelfPaymentInput,
): Promise<ReportSelfPaymentResult> {
  if (input.amountCents <= 0n) throw new Error("Amount must be positive.");
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    include: { unit: true },
  });
  if (!lease) throw new Error("Lease not found");

  const payment = await withAudit(
    {
      ...input.actor,
      action: "payment.self_reported",
      entityType: "Payment",
    },
    async (tx) => {
      const created = await tx.payment.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          unitId: lease.unitId,
          propertyId: lease.unit.propertyId,
          buildingId: lease.unit.buildingId,
          paymentDate: input.paymentDate ?? new Date(),
          amountCents: input.amountCents,
          method: input.method,
          referenceNumber: input.referenceNumber ?? null,
          // PENDING + reportedAt, and deliberately NO ledger entry/allocation.
          status: "pending",
          reportedAt: new Date(),
          notes: input.notes ?? null,
          // Server-minted unique key (the column is UNIQUE/non-null); a
          // self-report has no client idempotency key.
          idempotencyKey: `selfreport:${randomBytes(16).toString("hex")}`,
          createdBy: input.actor.actorId ?? null,
        },
      });
      return {
        result: { paymentId: created.id },
        entityId: created.id,
        after: {
          status: "pending",
          amountCents: input.amountCents.toString(),
          method: input.method,
          reportedAt: created.reportedAt?.toISOString() ?? null,
        },
      };
    },
  );
  return payment;
}

export interface ConfirmSelfReportResult {
  paymentId: string;
  alreadyPosted: boolean;
  leftoverCreditCents: bigint;
}

/**
 * Staff CONFIRM of a pending self-reported payment: the ONLY step that posts.
 * Flips status pending→posted, sets confirmedAt/By, and writes the ledger entry
 * + FIFO allocations via the shared createPaymentLedgerTx. Idempotent — re-reads
 * the row inside the tx and no-ops if it is already non-pending, so a double
 * confirm cannot double-post. Audited (payment.self_report_confirmed +
 * payment.posted from the shared helper).
 */
export async function confirmSelfReportedPayment(input: {
  paymentId: string;
  actor: AuditContext;
}): Promise<ConfirmSelfReportResult> {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment) throw new Error("Payment not found");
    if (payment.reportedAt === null) {
      throw new Error("Only a self-reported payment can be confirmed here.");
    }
    if (payment.status !== "pending") {
      return { paymentId: payment.id, alreadyPosted: true, leftoverCreditCents: 0n };
    }

    // CRITICAL double-post guard. The findUnique above is a lock-free read, so
    // at READ COMMITTED two concurrent confirms (two staff / a double-click /
    // two tabs) could BOTH see status="pending". This compare-and-swap UPDATE
    // is the real gate: it takes the row lock and only matches a still-pending
    // row, so the loser updates 0 rows and bails before any ledger write. This
    // is what stops a duplicate negative `payment` LedgerEntry (there is no
    // idempotencyKey collision to catch here, unlike postPayment).
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: {
        status: "posted",
        confirmedAt: new Date(),
        confirmedBy: input.actor.actorId ?? null,
      },
    });
    if (claimed.count === 0) {
      return { paymentId: payment.id, alreadyPosted: true, leftoverCreditCents: 0n };
    }

    const { leftoverCents } = await createPaymentLedgerTx(tx, {
      paymentId: payment.id,
      leaseId: payment.leaseId,
      tenantId: payment.tenantId,
      amountCents: payment.amountCents,
      paymentDate: payment.paymentDate,
      appliedPeriodKey: payment.appliedPeriodKey,
      method: payment.method,
      payerId: payment.payerId,
      actor: input.actor,
    });

    await writeAudit(tx, {
      ...input.actor,
      action: "payment.self_report_confirmed",
      entityType: "Payment",
      entityId: payment.id,
      before: { status: "pending" },
      after: { status: "posted", amountCents: payment.amountCents.toString() },
    });

    return { paymentId: payment.id, alreadyPosted: false, leftoverCreditCents: leftoverCents };
  });

  // Best-effort receipt after commit (only when we actually posted just now).
  if (!result.alreadyPosted) await ensureReceiptBestEffort(result.paymentId, input.actor);
  return result;
}

/**
 * Staff REJECT of a pending self-reported payment: marks it voided WITHOUT any
 * ledger touch (it never had a ledger entry, so the balance is unaffected).
 * Idempotent — only a still-pending self-report is rejected. Audited.
 */
export async function rejectSelfReportedPayment(input: {
  paymentId: string;
  reason: string;
  actor: AuditContext;
}): Promise<{ alreadyResolved: boolean }> {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId } });
    if (!payment) throw new Error("Payment not found");
    if (payment.reportedAt === null) {
      throw new Error("Only a self-reported payment can be rejected here.");
    }
    if (payment.status !== "pending") {
      return { alreadyResolved: true };
    }

    // Compare-and-swap like confirm: only a still-pending row flips to voided,
    // so a confirm/reject race (or double-click) can't both act on it. No
    // ledger touch either way — a pending self-report never had an entry.
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "pending" },
      data: { status: "voided" },
    });
    if (claimed.count === 0) {
      return { alreadyResolved: true };
    }

    await writeAudit(tx, {
      ...input.actor,
      action: "payment.self_report_rejected",
      entityType: "Payment",
      entityId: payment.id,
      before: { status: "pending" },
      after: { status: "voided", reason: input.reason },
    });

    return { alreadyResolved: false };
  });
}
