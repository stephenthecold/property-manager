import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { phoneKey } from "@/lib/portal/identity";

/**
 * SMS consent changes (audited). Two entry points share one audit action
 * (`tenant.sms_consent_changed`): inbound STOP/START keywords (matched to
 * tenants by phone) and the tenant-portal self-service toggle.
 */

/** Flip SMS consent for every tenant whose phone matches `fromPhone`. Returns affected count. */
export async function setSmsConsentByPhone(
  fromPhone: string,
  consent: boolean,
  actor: AuditContext,
): Promise<number> {
  const key = phoneKey(fromPhone);
  if (!key) return 0;

  // No "last N digits" operator in Prisma — match in JS over tenants with a phone.
  const candidates = await prisma.tenant.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, smsConsent: true },
  });
  const matches = candidates.filter((t) => phoneKey(t.phone) === key);

  let changed = 0;
  for (const t of matches) {
    if (t.smsConsent === consent) continue;
    await prisma.$transaction(async (tx) => {
      await tx.tenant.update({ where: { id: t.id }, data: { smsConsent: consent } });
      await writeAudit(tx, {
        ...actor,
        action: "tenant.sms_consent_changed",
        entityType: "Tenant",
        entityId: t.id,
        before: { smsConsent: t.smsConsent },
        after: { smsConsent: consent, source: "inbound_sms" },
      });
    });
    changed++;
  }
  return changed;
}

/** Set SMS consent for one tenant (portal self-service). Audited. */
export async function setTenantSmsConsent(
  tenantId: string,
  consent: boolean,
  actor: AuditContext,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { smsConsent: true },
    });
    await tx.tenant.update({ where: { id: tenantId }, data: { smsConsent: consent } });
    await writeAudit(tx, {
      ...actor,
      action: "tenant.sms_consent_changed",
      entityType: "Tenant",
      entityId: tenantId,
      before: { smsConsent: before?.smsConsent },
      after: { smsConsent: consent, source: "portal" },
    });
  });
}
