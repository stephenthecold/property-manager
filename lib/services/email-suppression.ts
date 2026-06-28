import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  isEmailSuppressed,
  normalizeEmail,
  type SuppressedEmailStatus,
} from "@/lib/reminders/suppression";

/**
 * Email bounce / auto-suppression service — the Prisma bridge over the pure
 * decisions in lib/reminders/suppression.ts. A hard bounce or spam complaint
 * suppresses a tenant's email: reminder sends then SKIP the email channel until
 * staff clear it (see resolveReminderDelivery in lib/reminders/channel.ts).
 *
 * This is a deliverability state, NOT consent: clearing it does not re-grant
 * email consent (emailConsent is a separate flag), it only lifts the bounce
 * block after the tenant fixes their address.
 */

/** Redact an email for the audit log (never store the full address). */
function redactEmail(email: string): string {
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 1)}***@${domain}` : "***";
}

export interface ApplyEmailBounceResult {
  /** Tenants newly suppressed by THIS call (already-suppressed ones excluded). */
  suppressed: number;
  /** Tenants matched by the bounced address (suppressed already or now). */
  matched: number;
}

/**
 * Apply a verified bounce/complaint for `email`: suppress every tenant whose
 * address matches (case-insensitive) and isn't already in this state. Idempotent
 * — a tenant already suppressed with the same status is a no-op (no DB write, no
 * audit row), so provider retries / duplicate callbacks converge. The caller
 * must have ALREADY authenticated the webhook; this trusts only `status`, which
 * is one of our two terminal values.
 *
 * Audited per newly-suppressed tenant (email redacted). Returns counts for the
 * webhook's response/logging; an unmatched address is a clean {0,0}.
 */
export async function applyEmailBounce(
  email: string,
  status: SuppressedEmailStatus,
  actor: AuditContext,
  now: Date = new Date(),
): Promise<ApplyEmailBounceResult> {
  const key = normalizeEmail(email);
  if (!key) return { suppressed: 0, matched: 0 };

  const tenants = await prisma.tenant.findMany({
    where: { email: { equals: key, mode: "insensitive" } },
    select: { id: true, emailDeliveryStatus: true },
  });
  if (tenants.length === 0) return { suppressed: 0, matched: 0 };

  const redacted = redactEmail(key);
  let suppressed = 0;
  for (const t of tenants) {
    // Idempotent: only write/audit when the status actually changes. (We DO
    // update when moving bounced→complained, since a complaint is newer info.)
    if (t.emailDeliveryStatus === status) continue;
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: t.id },
        data: { emailDeliveryStatus: status, emailSuppressedAt: now },
      });
      await writeAudit(tx, {
        ...actor,
        action: "tenant.email_suppressed",
        entityType: "Tenant",
        entityId: t.id,
        before: { emailDeliveryStatus: t.emailDeliveryStatus },
        // Never store the full address — only the redacted form + status.
        after: { emailDeliveryStatus: status, email: redacted },
      });
    });
    suppressed++;
  }
  return { suppressed, matched: tenants.length };
}

/**
 * Clear a tenant's email suppression (staff action, after the tenant fixes their
 * address). Idempotent: a tenant that isn't suppressed is a no-op. Audited.
 * Returns whether a change was made. Does NOT touch emailConsent.
 */
export async function clearEmailSuppression(
  tenantId: string,
  actor: AuditContext,
): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, emailDeliveryStatus: true },
  });
  if (!tenant) return false;
  if (!isEmailSuppressed(tenant.emailDeliveryStatus)) return false;

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { emailDeliveryStatus: null, emailSuppressedAt: null },
    });
    await writeAudit(tx, {
      ...actor,
      action: "tenant.email_suppression_cleared",
      entityType: "Tenant",
      entityId: tenant.id,
      before: { emailDeliveryStatus: tenant.emailDeliveryStatus },
      after: { emailDeliveryStatus: null },
    });
  });
  return true;
}
