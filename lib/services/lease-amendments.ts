import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  createSigningRequest,
  type CreateSigningRequestResult,
} from "@/lib/services/esign";
import {
  AMENDMENT_TEMPLATE,
  AMENDMENT_BODY_MAX,
  AMENDMENT_TITLE_MAX,
  amendmentVarOverrides,
  extractAmendmentTitle,
  validateAmendmentInput,
  type AmendmentInputError,
} from "@/lib/lease/amendment-format";

/**
 * Lease AMENDMENTS / addenda — a signed rider modifying an existing lease (pet
 * addendum, mid-term rent rider, added occupant, …). It reuses the WHOLE e-sign
 * engine via {@link createSigningRequest} with kind="amendment" and the
 * amendment's own document template, so the rider is multi-signer, landlord-
 * applied, frozen + hashed, and saved as a signed artifact like any agreement.
 *
 * Unlike a renewal, an amendment APPLIES no terms — there is nothing to roll
 * forward. It is a signed record only, so it never touches the ledger, rent, or
 * lease dates. No new tables: the SigningRequest (kind="amendment") IS the
 * record; the title is read back from its frozen documentText.
 */

const ERROR_COPY: Record<AmendmentInputError, string> = {
  title_required: 'Add a short title for the amendment (e.g. "Pet addendum").',
  title_too_long: `Keep the title to ${AMENDMENT_TITLE_MAX} characters or fewer.`,
  body_required: "Describe the change this amendment makes.",
  body_too_long: `The amendment text is too long (max ${AMENDMENT_BODY_MAX} characters).`,
};

/**
 * Draft + send an amendment for e-signature to every tenant on the lease. The
 * staff-entered title/body are injected as literal values into the amendment
 * template (single-pass render — injection-safe). Returns the same shape as
 * createSigningRequest so the caller can describe per-signer delivery.
 */
export async function createLeaseAmendment(i: {
  leaseId: string;
  title: string;
  body: string;
  actor: AuditContext;
  now?: Date;
}): Promise<CreateSigningRequestResult> {
  const valid = validateAmendmentInput({ title: i.title, body: i.body });
  if (!valid.ok) return { ok: false, error: ERROR_COPY[valid.error] };

  const result = await createSigningRequest({
    leaseId: i.leaseId,
    kind: "amendment",
    actor: i.actor,
    documentTemplate: AMENDMENT_TEMPLATE,
    varOverrides: amendmentVarOverrides({ title: i.title, body: i.body }),
    now: i.now,
  });
  if (!result.ok) return result;

  // Supplementary, human-readable audit (the engine already logged
  // esign.request_created): capture the amendment TITLE — never the body — so
  // the trail reads "amendment sent: Pet addendum". Best-effort; the send has
  // already succeeded, so an audit hiccup must not surface as a failure.
  try {
    await writeAudit(prisma, {
      ...i.actor,
      action: "amendment.created",
      entityType: "SigningRequest",
      entityId: result.requestId,
      after: { leaseId: i.leaseId, title: i.title.trim() },
    });
  } catch (e) {
    console.error("[amendment] supplementary audit failed:", e);
  }

  return result;
}

export type AmendmentDisplayStatus =
  | "out_for_signature"
  | "completed"
  | "canceled"
  | "expired";

export interface AmendmentSummary {
  id: string;
  title: string;
  status: AmendmentDisplayStatus;
  sentAt: Date;
  completedAt: Date | null;
  expiresAt: Date;
  signedDocumentId: string | null;
  signers: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    signedAt: Date | null;
    lastSentAt: Date | null;
  }[];
}

function displayStatus(
  status: string,
  expiresAt: Date,
  now: Date,
): AmendmentDisplayStatus {
  if (status === "completed") return "completed";
  if (status === "canceled") return "canceled";
  if (status === "sent" && expiresAt.getTime() <= now.getTime()) return "expired";
  return "out_for_signature";
}

/** Every amendment on a lease, newest first, with per-signer progress. */
export async function listAmendmentsForLease(
  leaseId: string,
  now: Date = new Date(),
): Promise<AmendmentSummary[]> {
  const rows = await prisma.signingRequest.findMany({
    where: { leaseId, kind: "amendment" },
    orderBy: { sentAt: "desc" },
    include: { signers: { orderBy: { createdAt: "asc" } } },
  });
  return rows.map((r) => ({
    id: r.id,
    title: extractAmendmentTitle(r.documentText),
    status: displayStatus(r.status, r.expiresAt, now),
    sentAt: r.sentAt,
    completedAt: r.completedAt,
    expiresAt: r.expiresAt,
    signedDocumentId: r.signedDocumentId,
    signers: r.signers.map((s) => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      signedAt: s.signedAt,
      lastSentAt: s.lastSentAt,
    })),
  }));
}
