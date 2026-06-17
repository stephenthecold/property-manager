import { prisma } from "@/lib/db";
import { writeAudit, type AuditContext, type Tx } from "@/lib/audit/audit";
import type { NotificationChannel } from "@/lib/generated/prisma/enums";
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
 * written as an append-only `ConsentRecord` (channel="sms"; the compliance proof: phone,
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

  const record = await prisma.consentRecord.create({
    data: {
      channel: "sms",
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
    prisma.consentRecord.findMany({
      where: { channel: "sms", consent: false, tenantId: { not: null } },
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

/**
 * Append a staff-sourced consent record (SMS or email) when a tenant's consent
 * flag actually changed, INSIDE the caller's transaction so the record commits
 * with the tenant write. No-op when unchanged. This closes the prior gap where
 * staff edits flipped the consent boolean without leaving a compliance trail —
 * and gives email the same history SMS already had. The dedicated SMS flows
 * (public form, portal, keywords) are untouched.
 */
export async function recordStaffConsentChange(
  tx: Tx,
  i: {
    tenantId: string;
    channel: NotificationChannel;
    consent: boolean;
    /** Previous effective state; null on tenant creation. */
    prior: boolean | null;
    phone: string | null;
    email: string | null;
    fullName: string | null;
    actor: AuditContext;
  },
): Promise<void> {
  if (i.prior === i.consent) return; // unchanged → no event
  const isSms = i.channel === "sms";
  await tx.consentRecord.create({
    data: {
      channel: i.channel,
      phone: isSms ? (phoneKey(i.phone) ?? i.phone ?? "unknown") : null,
      phoneRaw: isSms ? i.phone : null,
      email: i.email,
      fullName: i.fullName,
      tenantId: i.tenantId,
      consent: i.consent,
      source: "staff",
      // SMS keeps its exact opt-in language on record; email has no fixed text.
      consentText: isSms && i.consent ? SMS_CONSENT_TEXT : null,
      consentVersion: isSms && i.consent ? SMS_CONSENT_VERSION : null,
    },
  });
  await writeAudit(tx, {
    ...i.actor,
    action: isSms ? "tenant.sms_consent_changed" : "tenant.email_consent_changed",
    entityType: "Tenant",
    entityId: i.tenantId,
    before: isSms ? { smsConsent: i.prior } : { emailConsent: i.prior },
    after: isSms
      ? { smsConsent: i.consent, source: "staff" }
      : { emailConsent: i.consent, source: "staff" },
  });
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
    await tx.consentRecord.create({
      data: {
        channel: "sms",
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
