import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { planFifoAllocation } from "@/lib/accounting/allocation";
import { loadOpenChargesTx } from "@/lib/services/payments";
import { prorationForStart } from "@/lib/accounting/rent";
import {
  MANUAL_CHARGE_SPECS,
  signedManualAmountCents,
  type ManualChargeCategory,
} from "@/lib/accounting/manual-charge";

/**
 * Staff-posted one-off ledger entries (security/pet deposits, a missed move-in
 * prorate, other charges, and credits/concessions) — the manual counterpart to
 * the billing worker and the move-out disposition. Append-only and audited;
 * corrections are reversals, never edits/deletes. Every posting is idempotent
 * via a client token in sourceId (the LedgerEntry_manual_charge_source_uniq
 * partial index), so a double-submit can't double-charge.
 */

const SOURCE_TYPE = "manual_charge";

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002"
  );
}

export interface PostManualEntryInput {
  leaseId: string;
  category: ManualChargeCategory;
  /** Positive magnitude in cents; the category decides the sign. */
  amountCents: bigint;
  effectiveDate: Date;
  note: string | null;
  /** Client-minted idempotency token — one entry per token. */
  idempotencyKey: string;
  actor: AuditContext;
}

export type PostManualEntryResult =
  | { ok: true; entryId: string; alreadyExisted: boolean }
  | { ok: false; error: string };

export async function postManualLedgerEntry(
  input: PostManualEntryInput,
): Promise<PostManualEntryResult> {
  const spec = MANUAL_CHARGE_SPECS[input.category];
  if (!spec) return { ok: false, error: "Unknown category." };
  if (input.amountCents <= 0n) {
    return { ok: false, error: "Amount must be greater than zero." };
  }
  const key = input.idempotencyKey.trim();
  if (!key) return { ok: false, error: "Missing idempotency key." };

  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: {
      id: true,
      tenantId: true,
      startDate: true,
      endDate: true,
      dueDay: true,
      rentAmountCents: true,
      scheduledRentAmountCents: true,
      scheduledRentEffectiveDate: true,
      internetEnabled: true,
      internetFeeCents: true,
      unit: { select: { property: { select: { timezone: true } } } },
    },
  });
  if (!lease) return { ok: false, error: "Lease not found." };

  const signed = signedManualAmountCents(input.category, input.amountCents);

  // Prorated rent posts as a real rent_charge at the move-in proration anchor —
  // the otherwise-never-billed partial-month slot the worker reserves — so it
  // counts as rent and is collision-safe under the (leaseId, periodKey) index.
  let periodKey: string | null = null;
  if (input.category === "prorated_rent") {
    const tz = lease.unit.property.timezone;
    const pro = prorationForStart({
      startDate: lease.startDate,
      dueDay: lease.dueDay,
      tz,
      terms: {
        rentAmountCents: lease.rentAmountCents,
        scheduledRentAmountCents: lease.scheduledRentAmountCents,
        scheduledRentEffectiveDate: lease.scheduledRentEffectiveDate,
        internetEnabled: lease.internetEnabled,
        internetFeeCents: lease.internetFeeCents,
      },
      endDate: lease.endDate,
    });
    if (!pro) {
      return {
        ok: false,
        error:
          "This lease doesn't start mid-period, so there's no move-in rent to prorate — use “Other charge” for a non-rent charge.",
      };
    }
    periodKey = pro.periodKey;
    // The anchor slot must be empty (e.g. proration was off at lease creation).
    // If a rent charge already exists there, block rather than risk a confusing
    // second move-in charge.
    const existing = await prisma.ledgerEntry.findFirst({
      where: {
        leaseId: lease.id,
        periodKey,
        entryType: { in: ["rent_charge", "late_fee"] },
      },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        error: `A rent charge already exists for the move-in period (${periodKey}). Reverse it first if you need to re-post.`,
      };
    }
  }

  const description = input.note?.trim()
    ? `${spec.label} — ${input.note.trim()}`
    : spec.label;

  try {
    const entryId = await prisma.$transaction(async (tx) => {
      const entry = await tx.ledgerEntry.create({
        data: {
          leaseId: lease.id,
          tenantId: lease.tenantId,
          entryType: spec.entryType,
          amountCents: signed,
          periodKey,
          effectiveDate: input.effectiveDate,
          sourceType: SOURCE_TYPE,
          sourceId: key,
          description,
          createdBy: input.actor.actorId ?? null,
        },
      });

      // A credit retires open charges FIFO (mirrors deposit-disposition) so the
      // aging view stays consistent with the balance; any leftover simply lands
      // as a tenant credit balance.
      if (spec.sign === -1) {
        const open = await loadOpenChargesTx(tx, lease.id);
        const plan = planFifoAllocation(input.amountCents, open);
        for (const line of plan.allocations) {
          await tx.chargeAllocation.create({
            data: {
              chargeEntryId: line.chargeEntryId,
              paymentEntryId: entry.id,
              amountCents: line.amountCents,
            },
          });
        }
      }

      await writeAudit(tx, {
        ...input.actor,
        action: "ledger.manual_entry_posted",
        entityType: "LedgerEntry",
        entityId: entry.id,
        after: {
          leaseId: lease.id,
          category: input.category,
          entryType: spec.entryType,
          amountCents: signed.toString(),
          periodKey,
        },
      });
      return entry.id;
    });
    return { ok: true, entryId, alreadyExisted: false };
  } catch (e) {
    if (isUniqueViolation(e)) {
      // Replay with the same token → return the existing entry (idempotent).
      const existing = await prisma.ledgerEntry.findFirst({
        where: { sourceType: SOURCE_TYPE, sourceId: key },
        select: { id: true },
      });
      if (existing) return { ok: true, entryId: existing.id, alreadyExisted: true };
      // Not the token index → the prorate periodKey index (a concurrent post or
      // a worker race). Surface it as a period collision.
      return {
        ok: false,
        error: "A rent charge already exists for that period. Refresh and check the ledger.",
      };
    }
    throw e;
  }
}

export interface ReverseManualEntryInput {
  entryId: string;
  reason: string;
  actor: AuditContext;
}

export type ReverseManualEntryResult =
  | { ok: true; alreadyReversed: boolean }
  | { ok: false; error: string };

/**
 * Reverse a manually-posted entry: append an equal-and-opposite reversal (never
 * edit/delete) and unwind any allocations that reference it, so the balance and
 * aging self-correct. Idempotent — the reversal carries sourceId='reverse:<id>'
 * under the same partial unique index, so a double-reverse is a caught no-op.
 */
export async function reverseManualLedgerEntry(
  input: ReverseManualEntryInput,
): Promise<ReverseManualEntryResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "A reason is required to reverse an entry." };

  const entry = await prisma.ledgerEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      leaseId: true,
      tenantId: true,
      amountCents: true,
      sourceType: true,
      entryType: true,
    },
  });
  if (!entry) return { ok: false, error: "Entry not found." };
  if (entry.sourceType !== SOURCE_TYPE || entry.entryType === "reversal") {
    return {
      ok: false,
      error: "Only a manually-posted charge or credit can be reversed here.",
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          leaseId: entry.leaseId,
          tenantId: entry.tenantId,
          entryType: "reversal",
          amountCents: -entry.amountCents,
          effectiveDate: new Date(),
          sourceType: SOURCE_TYPE,
          sourceId: `reverse:${entry.id}`,
          reversesEntryId: entry.id,
          reason,
          description: "Manual entry reversed",
          createdBy: input.actor.actorId ?? null,
        },
      });

      // Unwind allocations that reference this entry (charge-side if it was a
      // charge, payment-side if it was a credit) with reversing rows — mirrors
      // voidPayment, so the open-charge/aging view self-corrects.
      const allocations = await tx.chargeAllocation.findMany({
        where: {
          reversesAllocationId: null,
          OR: [{ chargeEntryId: entry.id }, { paymentEntryId: entry.id }],
        },
      });
      for (const a of allocations) {
        await tx.chargeAllocation.create({
          data: {
            chargeEntryId: a.chargeEntryId,
            paymentEntryId: a.paymentEntryId,
            amountCents: a.amountCents,
            reversesAllocationId: a.id,
          },
        });
      }

      await writeAudit(tx, {
        ...input.actor,
        action: "ledger.manual_entry_reversed",
        entityType: "LedgerEntry",
        entityId: entry.id,
        before: {
          amountCents: entry.amountCents.toString(),
          entryType: entry.entryType,
        },
        after: { reversed: true, reason },
      });
    });
    return { ok: true, alreadyReversed: false };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: true, alreadyReversed: true };
    throw e;
  }
}
