import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  computeDisposition,
  validateDeductions,
  type DepositDeduction,
} from "@/lib/accounting/deposit-disposition";

/**
 * Move-out deposit dispositions. A draft is itemized by staff; FINALIZE posts
 * the settlement to the ledger — damages as a positive `adjustment` (the damage
 * chargeback) and the applied deposit as a negative `credit` — so the lease
 * balance reflects the outcome. The refund is the cash side (recorded on the
 * row, paid out separately). Ledger writes are append-only; the finalize is a
 * compare-and-swap on status so it can never double-post.
 */

export interface DispositionResultDTO {
  damagesTotalCents: bigint;
  depositAppliedCents: bigint;
  refundDueCents: bigint;
  balanceOwedCents: bigint;
  balanceAtFinalizeCents: bigint;
}

type Ok<T> = { ok: true } & T;
type Err = { ok: false; error: string };

/** Parse the stored deductions JSON into typed lines (cents as bigint). */
export function parseDeductions(raw: unknown): DepositDeduction[] {
  if (!Array.isArray(raw)) return [];
  const out: DepositDeduction[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const label = String((r as Record<string, unknown>).label ?? "").trim();
    const cents = (r as Record<string, unknown>).amountCents;
    let amountCents: bigint;
    try {
      amountCents = BigInt(String(cents ?? "0"));
    } catch {
      continue;
    }
    out.push({ label, amountCents });
  }
  return out;
}

/** Default refundable deposit = base security deposit + refundable extras. */
function defaultDepositHeld(lease: {
  securityDepositCents: bigint;
  deposits: { amountCents: bigint; nonRefundableCents: bigint }[];
}): bigint {
  const extras = lease.deposits.reduce(
    (sum, d) => sum + (d.amountCents - d.nonRefundableCents),
    0n,
  );
  return lease.securityDepositCents + (extras > 0n ? extras : 0n);
}

export async function createDraftDisposition(i: {
  leaseId: string;
  actor: AuditContext;
}): Promise<Ok<{ dispositionId: string }> | Err> {
  const lease = await prisma.lease.findUnique({
    where: { id: i.leaseId },
    select: {
      id: true,
      tenantId: true,
      securityDepositCents: true,
      deposits: { select: { amountCents: true, nonRefundableCents: true } },
    },
  });
  if (!lease) return { ok: false, error: "Lease not found." };

  // One open draft per lease — reuse it rather than stacking drafts.
  const existing = await prisma.depositDisposition.findFirst({
    where: { leaseId: i.leaseId, status: "draft" },
    select: { id: true },
  });
  if (existing) return { ok: true, dispositionId: existing.id };

  const depositHeldCents = defaultDepositHeld(lease);
  const disp = await prisma.$transaction(async (tx) => {
    const d = await tx.depositDisposition.create({
      data: {
        leaseId: lease.id,
        tenantId: lease.tenantId,
        status: "draft",
        depositHeldCents,
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "deposit.disposition_created",
      entityType: "DepositDisposition",
      entityId: d.id,
      after: { leaseId: lease.id, depositHeldCents: depositHeldCents.toString() },
    });
    return d;
  });
  return { ok: true, dispositionId: disp.id };
}

export async function updateDraftDisposition(i: {
  dispositionId: string;
  depositHeldCents: bigint;
  deductions: DepositDeduction[];
  notes?: string | null;
  actor: AuditContext;
}): Promise<Ok<{ dispositionId: string }> | Err> {
  if (i.depositHeldCents < 0n) {
    return { ok: false, error: "Deposit held cannot be negative." };
  }
  const valid = validateDeductions(i.deductions);
  if (!valid.ok) return valid;

  const disp = await prisma.depositDisposition.findUnique({
    where: { id: i.dispositionId },
    select: { id: true, status: true },
  });
  if (!disp) return { ok: false, error: "Disposition not found." };
  if (disp.status !== "draft") {
    return { ok: false, error: "A finalized disposition can't be edited." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.depositDisposition.update({
      where: { id: i.dispositionId },
      data: {
        depositHeldCents: i.depositHeldCents,
        deductions: i.deductions.map((d) => ({
          label: d.label.trim(),
          amountCents: d.amountCents.toString(),
        })),
        notes: i.notes?.trim() || null,
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "deposit.disposition_updated",
      entityType: "DepositDisposition",
      entityId: i.dispositionId,
      after: {
        depositHeldCents: i.depositHeldCents.toString(),
        deductionLines: i.deductions.length,
      },
    });
  });
  return { ok: true, dispositionId: i.dispositionId };
}

/**
 * Finalize: compute against the CURRENT ledger balance and post the settlement.
 * The status CAS (draft -> finalized) gates the postings, so a double-submit
 * (or a retry) can never post a second damage charge / deposit credit.
 */
export async function finalizeDisposition(i: {
  dispositionId: string;
  actor: AuditContext;
  now?: Date;
}): Promise<Ok<{ result: DispositionResultDTO }> | Err> {
  const now = i.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const disp = await tx.depositDisposition.findUnique({
      where: { id: i.dispositionId },
    });
    if (!disp) return { ok: false, error: "Disposition not found." };
    if (disp.status !== "draft") {
      return { ok: false, error: "This disposition is already finalized." };
    }

    const deductions = parseDeductions(disp.deductions);
    const valid = validateDeductions(deductions);
    if (!valid.ok) return valid;

    // Authoritative balance = SUM over all ledger entries (the owed invariant).
    const agg = await tx.ledgerEntry.aggregate({
      where: { leaseId: disp.leaseId },
      _sum: { amountCents: true },
    });
    const balanceCents = agg._sum.amountCents ?? 0n;
    const r = computeDisposition({
      balanceCents,
      depositHeldCents: disp.depositHeldCents,
      deductions,
    });

    // Compare-and-swap: claim the draft. If another tx already finalized it,
    // bail before posting anything — the postings happen exactly once.
    const claim = await tx.depositDisposition.updateMany({
      where: { id: disp.id, status: "draft" },
      data: { status: "finalized", finalizedAt: now },
    });
    if (claim.count === 0) {
      return { ok: false, error: "This disposition is already finalized." };
    }

    let damageEntryId: string | null = null;
    if (r.damagesTotalCents > 0n) {
      const e = await tx.ledgerEntry.create({
        data: {
          leaseId: disp.leaseId,
          tenantId: disp.tenantId,
          entryType: "adjustment",
          amountCents: r.damagesTotalCents, // + increases what the tenant owes
          effectiveDate: now,
          sourceType: "deposit_disposition",
          sourceId: disp.id,
          description: "Move-out damages chargeback",
          createdBy: i.actor.actorId ?? null,
        },
      });
      damageEntryId = e.id;
    }

    let depositCreditEntryId: string | null = null;
    if (r.depositAppliedCents > 0n) {
      const e = await tx.ledgerEntry.create({
        data: {
          leaseId: disp.leaseId,
          tenantId: disp.tenantId,
          entryType: "credit",
          amountCents: -r.depositAppliedCents, // - decreases what the tenant owes
          effectiveDate: now,
          sourceType: "deposit_disposition",
          sourceId: disp.id,
          description: "Security deposit applied",
          createdBy: i.actor.actorId ?? null,
        },
      });
      depositCreditEntryId = e.id;
    }

    await tx.depositDisposition.update({
      where: { id: disp.id },
      data: {
        balanceAtFinalizeCents: balanceCents,
        damagesTotalCents: r.damagesTotalCents,
        depositAppliedCents: r.depositAppliedCents,
        refundDueCents: r.refundDueCents,
        balanceOwedCents: r.balanceOwedCents,
        damageEntryId,
        depositCreditEntryId,
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "deposit.disposition_finalized",
      entityType: "DepositDisposition",
      entityId: disp.id,
      after: {
        leaseId: disp.leaseId,
        balanceAtFinalizeCents: balanceCents.toString(),
        damagesTotalCents: r.damagesTotalCents.toString(),
        depositAppliedCents: r.depositAppliedCents.toString(),
        refundDueCents: r.refundDueCents.toString(),
        balanceOwedCents: r.balanceOwedCents.toString(),
        damageEntryId,
        depositCreditEntryId,
      },
    });

    return {
      ok: true,
      result: {
        damagesTotalCents: r.damagesTotalCents,
        depositAppliedCents: r.depositAppliedCents,
        refundDueCents: r.refundDueCents,
        balanceOwedCents: r.balanceOwedCents,
        balanceAtFinalizeCents: balanceCents,
      },
    };
  });
}

export function getDisposition(dispositionId: string) {
  return prisma.depositDisposition.findUnique({ where: { id: dispositionId } });
}

export function listDispositionsForLease(leaseId: string) {
  return prisma.depositDisposition.findMany({
    where: { leaseId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}
