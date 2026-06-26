import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { postPayment } from "@/lib/services/payments";
import { parsePaymentEmail, paymentLineKey } from "@/lib/services/payment-email/parse";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";

/**
 * Bridge between the captured email inbox and the payment ledger (module
 * "mailbox"). The HEAVY lifting — the Payment row, its negative ledger entry,
 * and FIFO allocation — stays in the battle-tested postPayment; this module only
 * supplies the email's parsed/idempotent inputs and the email↔payment link.
 * Nothing here re-implements balance math.
 */

/** Active leases for the record-payment lease picker (and name matching). */
export async function listActiveLeaseOptions() {
  const leases = await prisma.lease.findMany({
    where: { status: { in: ["active", "month_to_month"] } },
    select: {
      id: true,
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { unitNumber: true, property: { select: { name: true } } } },
    },
    orderBy: [{ tenant: { lastName: "asc" } }, { tenant: { firstName: "asc" } }],
  });
  return leases.map((l) => ({
    leaseId: l.id,
    tenantFirst: l.tenant.firstName,
    tenantLast: l.tenant.lastName,
    label: `${l.tenant.firstName} ${l.tenant.lastName} — ${l.unit.property.name} ${l.unit.unitNumber}`,
  }));
}

/** Payments already recorded from / attached to this email. */
export async function paymentsForEmail(emailId: string) {
  return prisma.payment.findMany({
    where: { sourceEmailId: emailId },
    select: {
      id: true,
      idempotencyKey: true,
      amountCents: true,
      paymentDate: true,
      status: true,
      lease: {
        select: {
          id: true,
          tenant: { select: { id: true, firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** Recent posted payments to choose from when attaching an email as documentation. */
export async function recentPaymentsForAttach(limit = 50) {
  return prisma.payment.findMany({
    where: { status: "posted" },
    select: {
      id: true,
      amountCents: true,
      paymentDate: true,
      lease: { select: { tenant: { select: { firstName: true, lastName: true } } } },
    },
    orderBy: { paymentDate: "desc" },
    take: limit,
  });
}

/** The idempotency key for one parsed payment line of an email — also the link
 *  used to tell whether that specific line has already been recorded. */
export function emailPaymentIdempotencyKey(emailId: string, rowKey: string): string {
  return `inbound_email:${emailId}:${rowKey}`;
}

/** Count of distinct parsed payment lines on an email (for the all-handled flip). */
async function parsedLineCount(emailId: string): Promise<number> {
  const email = await prisma.inboundEmail.findUnique({
    where: { id: emailId },
    select: { fromEmail: true, subject: true, body: true },
  });
  if (!email) return 0;
  return parsePaymentEmail({
    fromEmail: email.fromEmail,
    subject: email.subject,
    body: email.body,
  }).lines.length;
}

/** Flip the email to "posted" once every parsed line has been RECORDED (mirrors
 *  the expense-post terminal state, incl. handledBy/handledAt/readAt). Counts
 *  only payments recorded-FROM this email (idempotency-key prefix) that are
 *  still posted — merely-attached or voided payments must not complete it, or a
 *  line could be hidden from the work queue un-recorded. Never touches the ledger. */
async function flipIfAllHandled(emailId: string, actor: AuditContext): Promise<void> {
  const email = await prisma.inboundEmail.findUnique({
    where: { id: emailId },
    select: { fromEmail: true, subject: true, body: true, status: true, readAt: true },
  });
  if (!email || email.status === "posted") return;
  const lines = parsePaymentEmail({
    fromEmail: email.fromEmail,
    subject: email.subject,
    body: email.body,
  }).lines;
  if (lines.length === 0) return;

  const prefix = `inbound_email:${emailId}:`;
  const posted = await prisma.payment.findMany({
    where: { sourceEmailId: emailId, status: "posted" },
    select: { idempotencyKey: true },
  });
  const recordedKeys = new Set(
    posted.map((p) => p.idempotencyKey).filter((k) => k.startsWith(prefix)),
  );
  const allRecorded = lines.every((line, i) =>
    recordedKeys.has(emailPaymentIdempotencyKey(emailId, paymentLineKey(line, i))),
  );
  // A single-payment email is also "done" once attached to an existing payment.
  const singleAttached = lines.length === 1 && posted.length > recordedKeys.size;
  if (!allRecorded && !singleAttached) return;

  await prisma.inboundEmail.updateMany({
    where: { id: emailId, status: { not: "posted" } },
    data: {
      status: "posted",
      handledBy: actor.actorId ?? null,
      handledAt: new Date(),
      readAt: email.readAt ?? new Date(),
    },
  });
}

/** Link an email's stored attachments to a payment (best-effort, only when the
 *  email is a single payment so there's no ambiguity about which line owns them). */
async function linkAttachmentsIfSingleLine(
  emailId: string,
  paymentId: string,
): Promise<void> {
  if ((await parsedLineCount(emailId)) !== 1) return;
  await prisma.uploadedDocument.updateMany({
    where: { inboundEmailId: emailId },
    data: { paymentId },
  });
}

export interface RecordInboundPaymentInput {
  emailId: string;
  rowKey: string;
  leaseId: string;
  amountCents: bigint;
  paymentDate: Date;
  method: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
  actor: AuditContext;
}

/** Record a NEW payment from one parsed email line. Idempotent per (email,row)
 *  so re-submitting the same line never double-credits. */
export async function recordInboundPayment(
  input: RecordInboundPaymentInput,
): Promise<{ paymentId: string; alreadyExisted: boolean; leftoverCreditCents: bigint }> {
  const res = await postPayment({
    leaseId: input.leaseId,
    amountCents: input.amountCents,
    paymentDate: input.paymentDate,
    method: input.method,
    referenceNumber: input.referenceNumber,
    notes: input.notes,
    sourceEmailId: input.emailId,
    idempotencyKey: emailPaymentIdempotencyKey(input.emailId, input.rowKey),
    actor: input.actor,
  });
  await linkAttachmentsIfSingleLine(input.emailId, res.paymentId);
  await flipIfAllHandled(input.emailId, input.actor);
  return res;
}

/** Attach an email to a payment that was ALREADY recorded (e.g. entered by hand)
 *  as supporting documentation — links it + the email's attachments. No ledger
 *  write. */
export async function attachEmailToPayment(input: {
  emailId: string;
  paymentId: string;
  actor: AuditContext;
}): Promise<{ ok: boolean; reason?: "not_found" | "linked_elsewhere" }> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, sourceEmailId: true },
  });
  if (!payment) return { ok: false, reason: "not_found" };
  // Never steal a payment already linked to a DIFFERENT email (which would also
  // re-point that email's attachments). Re-attaching the same email is fine.
  if (payment.sourceEmailId && payment.sourceEmailId !== input.emailId) {
    return { ok: false, reason: "linked_elsewhere" };
  }
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: input.paymentId },
      data: { sourceEmailId: input.emailId },
    });
    await writeAudit(tx, {
      ...input.actor,
      action: "inbound_email.payment_attached",
      entityType: "Payment",
      entityId: input.paymentId,
      after: { sourceEmailId: input.emailId },
    });
  });
  await linkAttachmentsIfSingleLine(input.emailId, input.paymentId);
  await flipIfAllHandled(input.emailId, input.actor);
  return { ok: true };
}
