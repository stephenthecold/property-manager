import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { phoneKey } from "@/lib/portal/identity";
import {
  SMS_CONSENT_TEXT,
  SMS_CONSENT_VERSION,
  type SmsConsentSource,
} from "@/lib/sms/consent-text";
import {
  deriveSmsConsentStatus,
  type SmsConsentStatus,
} from "@/lib/sms/consent-status";

/**
 * SMS consent — the effective state is `Tenant.smsConsent`; every change is also
 * written as an append-only `SmsConsentRecord` (the compliance proof: phone,
 * status, timestamp, source, exact consent text/version, IP, user agent).
 * Entry points: the public opt-in form, the rental application, the portal
 * toggle, inbound STOP/START keywords, and staff.
 */

export interface ConsentMeta {
  fullName?: string | null;
  email?: string | null;
  propertyUnit?: string | null;
  applicationId?: string | null;
  consentText?: string | null;
  consentVersion?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Tenants whose stored phone matches `rawPhone` (last-10-digit key). */
async function matchTenantsByPhone(rawPhone: string) {
  const key = phoneKey(rawPhone);
  if (!key) return [];
  const candidates = await prisma.tenant.findMany({
    where: { phone: { not: null } },
    select: { id: true, phone: true, smsConsent: true },
  });
  return candidates.filter((t) => phoneKey(t.phone) === key);
}

/**
 * Record a phone-based consent EVENT and apply it to any matching tenant(s).
 * Used by the public opt-in form and inbound keywords. Returns the count of
 * tenants whose effective consent changed.
 */
export async function recordSmsConsent(
  rawPhone: string,
  consent: boolean,
  source: SmsConsentSource,
  actor: AuditContext,
  meta: ConsentMeta = {},
): Promise<{ recordId: string; matchedTenants: number }> {
  const key = phoneKey(rawPhone);
  const matches = await matchTenantsByPhone(rawPhone);
  const tenantId = matches[0]?.id ?? null;

  const record = await prisma.smsConsentRecord.create({
    data: {
      phone: key ?? rawPhone.trim(),
      phoneRaw: rawPhone.trim() || null,
      fullName: meta.fullName ?? null,
      email: meta.email ?? null,
      tenantId,
      applicationId: meta.applicationId ?? null,
      propertyUnit: meta.propertyUnit ?? null,
      consent,
      source,
      consentText: meta.consentText ?? (consent ? SMS_CONSENT_TEXT : null),
      consentVersion: meta.consentVersion ?? (consent ? SMS_CONSENT_VERSION : null),
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });

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
        after: { smsConsent: consent, source },
      });
    });
    changed++;
  }
  return { recordId: record.id, matchedTenants: changed };
}

export interface TenantConsentRow {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  smsConsent: boolean;
  status: SmsConsentStatus;
}

/**
 * Every active tenant with a derived SMS consent status (for the admin
 * view/filter). "opted_out" = an explicit prior opt-out record exists;
 * "not_opted_in" = never engaged; "missing_mobile" = no phone on file.
 */
export async function listTenantConsentStatuses(): Promise<TenantConsentRow[]> {
  const [tenants, optOutRows] = await Promise.all([
    prisma.tenant.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        smsConsent: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
    prisma.smsConsentRecord.findMany({
      where: { consent: false, tenantId: { not: null } },
      select: { tenantId: true },
      distinct: ["tenantId"],
    }),
  ]);
  const optedOut = new Set(
    optOutRows.map((r) => r.tenantId).filter((x): x is string => !!x),
  );
  return tenants.map((t) => ({
    ...t,
    status: deriveSmsConsentStatus({
      phone: t.phone,
      smsConsent: t.smsConsent,
      hasOptOutRecord: optedOut.has(t.id),
    }),
  }));
}

/** Inbound STOP/START handler: record + apply, sourced as inbound_sms_keyword. */
export async function setSmsConsentByPhone(
  fromPhone: string,
  consent: boolean,
  actor: AuditContext,
): Promise<number> {
  const { matchedTenants } = await recordSmsConsent(
    fromPhone,
    consent,
    "inbound_sms_keyword",
    actor,
  );
  return matchedTenants;
}

/** Set SMS consent for one tenant (portal / staff). Audited + recorded. */
export async function setTenantSmsConsent(
  tenantId: string,
  consent: boolean,
  actor: AuditContext,
  source: SmsConsentSource = "portal",
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { smsConsent: true, phone: true, firstName: true, lastName: true, email: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: tenantId }, data: { smsConsent: consent } });
    await tx.smsConsentRecord.create({
      data: {
        phone: phoneKey(tenant?.phone) ?? (tenant?.phone ?? "unknown"),
        phoneRaw: tenant?.phone ?? null,
        fullName: tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : null,
        email: tenant?.email ?? null,
        tenantId,
        consent,
        source,
        consentText: consent ? SMS_CONSENT_TEXT : null,
        consentVersion: consent ? SMS_CONSENT_VERSION : null,
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: "tenant.sms_consent_changed",
      entityType: "Tenant",
      entityId: tenantId,
      before: { smsConsent: tenant?.smsConsent },
      after: { smsConsent: consent, source },
    });
  });
}
