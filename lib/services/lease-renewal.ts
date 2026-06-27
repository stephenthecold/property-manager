import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext, type Tx } from "@/lib/audit/audit";
import {
  createSigningRequest,
  cancelSigningRequest,
} from "@/lib/services/esign";
import { formatCurrency } from "@/lib/money";
import { formatDateInTz } from "@/lib/dates";
import {
  computeRenewalTerms,
  isRenewalModel,
  isRenewalOpen,
  validateRenewalOffer,
} from "@/lib/leases/renewal";

/**
 * Lease renewal offers. Staff propose new terms (rent + term); the tenant accepts
 * by e-signing a SigningRequest with kind="renewal" — the WHOLE e-sign engine is
 * reused (multi-signer, landlord-applied, wording diff). The signed document is
 * rendered with the proposed terms (via `varOverrides`), so the tenant signs the
 * NEW rent/end date. On completion {@link applyAcceptedRenewal} applies the terms.
 *
 * v1 ships the "extend" model — push THIS lease's endDate and set a scheduled
 * rent increase the billing worker already rolls forward (audited). The
 * "successor" model (mint a new lease) is reserved in the schema but not yet
 * accepted, because ending the prior lease at the right moment (its own endDate,
 * not acceptance time) needs its own careful, separately-verified pass.
 */

export type CreateRenewalResult =
  | { ok: true; offerId: string }
  | { ok: false; error: string };

export async function createRenewalOffer(i: {
  leaseId: string;
  renewalModel: string;
  proposedRentCents: bigint;
  termMonths: number;
  actor: AuditContext;
  now?: Date;
}): Promise<CreateRenewalResult> {
  const now = i.now ?? new Date();

  if (!isRenewalModel(i.renewalModel)) {
    return { ok: false, error: "Invalid renewal model." };
  }
  if (i.renewalModel === "successor") {
    return {
      ok: false,
      error:
        "Successor-lease renewals aren't available yet — use Extend (same lease, new term + rent) for now.",
    };
  }
  if (!Number.isInteger(i.termMonths) || i.termMonths < 1 || i.termMonths > 60) {
    return { ok: false, error: "Renewal term must be between 1 and 60 months." };
  }

  const lease = await prisma.lease.findUnique({
    where: { id: i.leaseId },
    include: {
      unit: {
        include: { property: { select: { timezone: true, currency: true } } },
      },
    },
  });
  if (!lease) return { ok: false, error: "Lease not found." };
  // A renewal sets its OWN scheduled rent on acceptance; refuse to send one over
  // a rent increase staff already scheduled, so accepting it can't silently
  // clobber that pending increase (apply/clear it first).
  if (lease.scheduledRentAmountCents != null) {
    return {
      ok: false,
      error:
        "This lease already has a scheduled rent increase — apply or clear it before sending a renewal.",
    };
  }
  const tz = lease.unit.property.timezone;
  const currency = lease.unit.property.currency;

  const { effectiveDate, newEndDate } = computeRenewalTerms({
    currentEndDate: lease.endDate ?? now,
    termMonths: i.termMonths,
    tz,
  });
  const valid = validateRenewalOffer({
    currentEndDate: lease.endDate,
    proposedEndDate: newEndDate,
    proposedRentCents: i.proposedRentCents,
  });
  if (!valid.ok) return { ok: false, error: valid.error };

  // One open offer at a time — like the e-sign "already in progress" guard.
  const open = await prisma.leaseRenewalOffer.findFirst({
    where: { leaseId: i.leaseId, status: { in: ["draft", "sent"] } },
    select: { id: true },
  });
  if (open) {
    return {
      ok: false,
      error: "A renewal offer is already open for this lease — cancel it first.",
    };
  }

  // Record the offer (draft) + audit, then send the e-sign with the new terms.
  const offer = await prisma.$transaction(async (tx) => {
    const o = await tx.leaseRenewalOffer.create({
      data: {
        leaseId: i.leaseId,
        renewalModel: i.renewalModel,
        status: "draft",
        proposedRentAmountCents: i.proposedRentCents,
        proposedEndDate: newEndDate,
        effectiveDate,
        createdBy: i.actor.actorId ?? null,
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "renewal.offer_created",
      entityType: "LeaseRenewalOffer",
      entityId: o.id,
      after: {
        leaseId: i.leaseId,
        renewalModel: i.renewalModel,
        proposedRentAmountCents: i.proposedRentCents.toString(),
        proposedEndDate: newEndDate.toISOString(),
        effectiveDate: effectiveDate.toISOString(),
      },
    });
    return o;
  });

  // Render the signing document with the PROPOSED rent + end date.
  const varOverrides = {
    rent: formatCurrency(i.proposedRentCents, currency),
    end_date: formatDateInTz(newEndDate, tz),
  };
  const sent = await createSigningRequest({
    leaseId: i.leaseId,
    kind: "renewal",
    actor: i.actor,
    varOverrides,
    now,
  });
  if (!sent.ok) {
    // Don't strand a draft offer on the lease if the e-sign couldn't be sent.
    await prisma.leaseRenewalOffer.update({
      where: { id: offer.id },
      data: { status: "canceled" },
    });
    return { ok: false, error: sent.error };
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaseRenewalOffer.update({
      where: { id: offer.id },
      data: { status: "sent", signingRequestId: sent.requestId, sentAt: now },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "renewal.offer_sent",
      entityType: "LeaseRenewalOffer",
      entityId: offer.id,
      after: { signingRequestId: sent.requestId },
    });
  });

  return { ok: true, offerId: offer.id };
}

export async function cancelRenewalOffer(i: {
  offerId: string;
  actor: AuditContext;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const offer = await prisma.leaseRenewalOffer.findUnique({
    where: { id: i.offerId },
  });
  if (!offer) return { ok: false, error: "Renewal offer not found." };
  if (!isRenewalOpen(offer.status)) {
    return { ok: false, error: "This renewal offer is no longer open." };
  }

  // Cancel the linked e-sign so the tenant's link stops working (best-effort).
  if (offer.signingRequestId) {
    try {
      await cancelSigningRequest({ requestId: offer.signingRequestId, actor: i.actor });
    } catch (e) {
      console.error("[renewal] cancel of linked signing request failed:", e);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.leaseRenewalOffer.update({
      where: { id: i.offerId },
      data: { status: "canceled" },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "renewal.offer_canceled",
      entityType: "LeaseRenewalOffer",
      entityId: i.offerId,
    });
  });
  return { ok: true };
}

/**
 * Apply an accepted renewal's terms — called from `completeIfAllSigned` inside
 * the SAME transaction that marks the signing request completed, so the offer
 * and the lease change commit together. No-op when the signing request carries
 * no open renewal offer.
 */
export async function applyAcceptedRenewal(
  tx: Tx,
  signingRequestId: string,
  now: Date,
): Promise<void> {
  const offer = await tx.leaseRenewalOffer.findFirst({
    where: { signingRequestId, status: "sent" },
  });
  if (!offer) return;

  if (offer.renewalModel !== "extend") {
    // Should be unreachable — only "extend" offers can be created today.
    console.error(
      `[renewal] offer ${offer.id} has unsupported model "${offer.renewalModel}"; not applying.`,
    );
    return;
  }

  // Capture the prior endDate + scheduled rent so the audit trail records what
  // the renewal replaced (creation refuses an offer over a pending increase, but
  // one could be scheduled in the days between send and signature).
  const prior = await tx.lease.findUnique({
    where: { id: offer.leaseId },
    select: {
      endDate: true,
      scheduledRentAmountCents: true,
      scheduledRentEffectiveDate: true,
    },
  });

  // Extend: push the endDate and set a scheduled rent increase. The billing
  // worker rolls scheduledRentAmountCents -> rentAmountCents when the effective
  // date passes (audited as lease.rent_increase_applied) — we reuse that path
  // rather than mutating the live rent, so nothing bills the new rent early.
  await tx.lease.update({
    where: { id: offer.leaseId },
    data: {
      endDate: offer.proposedEndDate,
      scheduledRentAmountCents: offer.proposedRentAmountCents,
      scheduledRentEffectiveDate: offer.effectiveDate,
    },
  });
  await tx.leaseRenewalOffer.update({
    where: { id: offer.id },
    data: { status: "accepted", acceptedAt: now },
  });
  await writeAudit(tx, {
    actorType: "system",
    action: "renewal.applied_extend",
    entityType: "Lease",
    entityId: offer.leaseId,
    before: {
      endDate: prior?.endDate?.toISOString() ?? null,
      scheduledRentAmountCents: prior?.scheduledRentAmountCents?.toString() ?? null,
      scheduledRentEffectiveDate: prior?.scheduledRentEffectiveDate?.toISOString() ?? null,
    },
    after: {
      offerId: offer.id,
      endDate: offer.proposedEndDate.toISOString(),
      scheduledRentAmountCents: offer.proposedRentAmountCents.toString(),
      effectiveDate: offer.effectiveDate.toISOString(),
    },
  });
}

/** Open + recent renewal offers for a lease (staff agreement page), newest first. */
export function listRenewalOffersForLease(leaseId: string) {
  return prisma.leaseRenewalOffer.findMany({
    where: { leaseId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
}
