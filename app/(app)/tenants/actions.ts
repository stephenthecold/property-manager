"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { requireCapability, auditActor } from "@/lib/auth/session";
import { writeAudit, withAudit } from "@/lib/audit/audit";
import { PaymentMethod } from "@/lib/generated/prisma/enums";
import type { NotificationChannel } from "@/lib/generated/prisma/enums";
import {
  invitePortalAccount,
  setPortalAccountActive,
} from "@/lib/services/portal-auth";
import { createTrialToken, startImpersonation } from "@/lib/services/impersonation";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { recordStaffConsentChange } from "@/lib/services/sms-consent";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { publicBaseUrl } from "@/lib/http/base-url";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** "" → null; anything else must be a PaymentMethod enum value. */
function parsePreferredMethod(raw: string): PaymentMethod | null {
  return raw in PaymentMethod ? (raw as PaymentMethod) : null;
}

function parseReminderChannel(raw: string): NotificationChannel {
  return raw === "email" ? "email" : "sms";
}

export async function createTenant(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("tenants.manage");
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  const smsConsent = fd.get("smsConsent") === "on";
  const emailConsent = fd.get("emailConsent") === "on";
  const phone = str(fd, "phone") || null;
  const email = str(fd, "email") || null;
  const actor = await auditActor();
  const tenant = await prisma.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: {
        firstName,
        lastName,
        phone,
        email,
        mailingAddress: str(fd, "mailingAddress") || null,
        emergencyContactName: str(fd, "emergencyContactName") || null,
        emergencyContactPhone: str(fd, "emergencyContactPhone") || null,
        smsConsent,
        emailConsent,
        reminderChannel: parseReminderChannel(str(fd, "reminderChannel")),
        notes: str(fd, "notes") || null,
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: "tenant.created",
      entityType: "Tenant",
      entityId: created.id,
      after: { firstName, lastName },
    });
    // Record an initial consent event per channel that starts opted-in (prior =
    // null/false on creation), so the compliance trail begins at tenant creation.
    const fullName = `${firstName} ${lastName}`.trim();
    await recordStaffConsentChange(tx, {
      tenantId: created.id, channel: "sms", consent: smsConsent, prior: false,
      phone, email, fullName, actor,
    });
    await recordStaffConsentChange(tx, {
      tenantId: created.id, channel: "email", consent: emailConsent, prior: false,
      phone, email, fullName, actor,
    });
    return created;
  });
  redirect(`/tenants/${tenant.id}`);
}

export async function updateTenant(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("tenants.manage");
  const tenantId = str(fd, "tenantId");
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!tenantId || !firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return { error: "Tenant not found." };

  const data = {
    firstName,
    lastName,
    phone: str(fd, "phone") || null,
    email: str(fd, "email") || null,
    mailingAddress: str(fd, "mailingAddress") || null,
    emergencyContactName: str(fd, "emergencyContactName") || null,
    emergencyContactPhone: str(fd, "emergencyContactPhone") || null,
    smsConsent: fd.get("smsConsent") === "on",
    emailConsent: fd.get("emailConsent") === "on",
    reminderChannel: parseReminderChannel(str(fd, "reminderChannel")),
    isActive: fd.get("isActive") === "on",
    preferredPaymentMethod: parsePreferredMethod(str(fd, "preferredPaymentMethod")),
    notes: str(fd, "notes") || null,
  };

  const actor = await auditActor();
  await withAudit(
    {
      ...actor,
      action: "tenant.updated",
      entityType: "Tenant",
      entityId: tenant.id,
      before: {
        firstName: tenant.firstName,
        lastName: tenant.lastName,
        phone: tenant.phone,
        email: tenant.email,
        mailingAddress: tenant.mailingAddress,
        emergencyContactName: tenant.emergencyContactName,
        emergencyContactPhone: tenant.emergencyContactPhone,
        smsConsent: tenant.smsConsent,
        emailConsent: tenant.emailConsent,
        isActive: tenant.isActive,
        preferredPaymentMethod: tenant.preferredPaymentMethod,
        notes: tenant.notes,
      },
    },
    async (tx) => {
      const updated = await tx.tenant.update({ where: { id: tenant.id }, data });
      // Compliance trail for staff-initiated consent changes (both channels).
      const fullName = `${data.firstName} ${data.lastName}`.trim();
      await recordStaffConsentChange(tx, {
        tenantId: tenant.id, channel: "sms", consent: data.smsConsent,
        prior: tenant.smsConsent, phone: data.phone, email: data.email, fullName, actor,
      });
      await recordStaffConsentChange(tx, {
        tenantId: tenant.id, channel: "email", consent: data.emailConsent,
        prior: tenant.emailConsent, phone: data.phone, email: data.email, fullName, actor,
      });
      return { result: updated, after: data };
    },
  );

  revalidatePath(`/tenants/${tenant.id}`);
  revalidatePath("/tenants");
  return { ok: true };
}

/**
 * Archive/unarchive guard failures land back on the tenants list as a ?error=
 * banner — a thrown server-action error renders as the opaque production digest
 * page (same pattern as the lease archive/delete actions).
 */
function failToTenants(message: string): never {
  redirect(`/tenants?error=${encodeURIComponent(message)}`);
}

/**
 * Archive a tenant: hide them from the active list and block attachment to NEW
 * leases (every lease/co-tenant picker already filters `isActive: true`), and
 * disable any tenant-portal login (the portal already rejects an inactive
 * tenant; this also drops live sessions). History is never deleted. Refused
 * while the tenant is still on an active/month-to-month lease — end it first.
 */
export async function archiveTenantAction(fd: FormData): Promise<void> {
  await requireCapability("tenants.manage");
  const tenantId = str(fd, "tenantId");
  if (!tenantId) failToTenants("Missing tenant id.");
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) failToTenants("Tenant not found.");
  if (!tenant.isActive) {
    revalidatePath(`/tenants/${tenantId}`);
    return; // already archived — nothing to do
  }
  const onActiveLease = await prisma.lease.findFirst({
    where: {
      status: { in: ["active", "month_to_month"] },
      OR: [{ tenantId }, { coTenants: { some: { tenantId } } }],
    },
    select: { id: true },
  });
  if (onActiveLease) {
    failToTenants(
      "This tenant is still on an active lease — terminate the lease first, then archive.",
    );
  }

  const actor = await auditActor();
  await withAudit(
    {
      ...actor,
      action: "tenant.archived",
      entityType: "Tenant",
      entityId: tenant.id,
      before: { isActive: tenant.isActive },
    },
    async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: tenant.id },
        data: { isActive: false },
      });
      return { result: updated, after: { isActive: false } };
    },
  );
  // Also disable any tenant-portal login. Its own transaction (kills sessions +
  // audits); a missing account is a no-op. Never let a portal hiccup undo the
  // archive — the tenant flag flip already blocks portal login on its own.
  await setPortalAccountActive({ tenantId, isActive: false, actor }).catch(() => {});

  revalidatePath("/tenants");
  revalidatePath(`/tenants/${tenantId}`);
}

/**
 * Restore an archived tenant so they can be attached to new leases again. The
 * tenant-portal login stays disabled until separately re-enabled (re-granting
 * portal access should be a deliberate step).
 */
export async function unarchiveTenantAction(fd: FormData): Promise<void> {
  await requireCapability("tenants.manage");
  const tenantId = str(fd, "tenantId");
  if (!tenantId) failToTenants("Missing tenant id.");
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) failToTenants("Tenant not found.");
  if (tenant.isActive) {
    revalidatePath(`/tenants/${tenantId}`);
    return; // already active — nothing to do
  }
  await withAudit(
    {
      ...(await auditActor()),
      action: "tenant.unarchived",
      entityType: "Tenant",
      entityId: tenant.id,
      before: { isActive: tenant.isActive },
    },
    async (tx) => {
      const updated = await tx.tenant.update({
        where: { id: tenant.id },
        data: { isActive: true },
      });
      return { result: updated, after: { isActive: true } };
    },
  );
  revalidatePath("/tenants");
  revalidatePath(`/tenants/${tenantId}`);
}

export interface InlineTenantState {
  ok?: boolean;
  error?: string;
  /** The created tenant, shaped for the lease form's option list. */
  tenant?: { id: string; label: string };
}

/**
 * Create a tenant from INSIDE another flow (the lease-creation form) and RETURN
 * it instead of redirecting, so the caller can drop it into its picker and
 * select it. A lean subset of {@link createTenant} (name + contact); the rest
 * of the profile (consent, emergency contact, …) is filled in later from the
 * tenant page. Same capability gate, and audited.
 */
export async function createTenantInline(
  _prev: InlineTenantState,
  fd: FormData,
): Promise<InlineTenantState> {
  await requireCapability("tenants.manage");
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  const phone = str(fd, "phone") || null;
  const email = str(fd, "email") || null;
  const actor = await auditActor();
  const tenant = await prisma.$transaction(async (tx) => {
    const created = await tx.tenant.create({
      data: { firstName, lastName, phone, email },
    });
    await writeAudit(tx, {
      ...actor,
      action: "tenant.created",
      entityType: "Tenant",
      entityId: created.id,
      after: { firstName, lastName, inline: true },
    });
    return created;
  });
  revalidatePath("/tenants");
  return {
    ok: true,
    tenant: { id: tenant.id, label: `${tenant.lastName}, ${tenant.firstName}` },
  };
}

// ---------------------------------------------------------------------------
// Tenant portal (module "tenantPortal") — invite + enable/disable, portal.manage
// ---------------------------------------------------------------------------

export interface PortalInviteState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Shown to staff when no channel delivered (stub providers / no contact). */
  link?: string;
}

export async function invitePortalAccountAction(
  _prev: PortalInviteState,
  fd: FormData,
): Promise<PortalInviteState> {
  await requireCapability("portal.manage");
  await assertModuleEnabled("tenantPortal");
  const tenantId = str(fd, "tenantId");
  if (!tenantId) return { error: "Missing tenant." };
  const result = await invitePortalAccount({
    tenantId,
    actor: await auditActor(),
  });
  if (!result.ok) return { error: result.error ?? "Invite failed." };
  revalidatePath(`/tenants/${tenantId}`);
  const channels = [
    result.sms === "sent" ? "text" : null,
    result.email === "sent" ? "email" : null,
  ].filter(Boolean);
  return {
    ok: true,
    message:
      channels.length > 0
        ? `Invite link sent by ${channels.join(" and ")}. It expires in 7 days.`
        : "Invite created, but no message could be delivered — share the link below directly.",
    link: result.linkForOperator,
  };
}

export async function setPortalAccountActiveAction(
  _prev: PortalInviteState,
  fd: FormData,
): Promise<PortalInviteState> {
  await requireCapability("portal.manage");
  await assertModuleEnabled("tenantPortal");
  const tenantId = str(fd, "tenantId");
  const isActive = str(fd, "isActive") === "true";
  if (!tenantId) return { error: "Missing tenant." };
  const result = await setPortalAccountActive({
    tenantId,
    isActive,
    actor: await auditActor(),
  });
  if (!result.ok) return { error: result.error ?? "Update failed." };
  revalidatePath(`/tenants/${tenantId}`);
  return {
    ok: true,
    message: isActive
      ? "Portal login enabled."
      : "Portal login disabled — their sessions were signed out.",
  };
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return {
    ip: clientIpFromXff(h.get("x-forwarded-for")),
    userAgent: h.get("user-agent"),
  };
}

/** Open the portal AS this tenant in the current browser (portal.impersonate). */
export async function impersonateTenantAction(fd: FormData): Promise<void> {
  await requireCapability("portal.impersonate");
  await assertModuleEnabled("tenantPortal");
  const tenantId = str(fd, "tenantId");
  if (!tenantId) throw new Error("Missing tenant.");
  const actor = await auditActor();
  const meta = await requestMeta();
  await startImpersonation(tenantId, actor.actorId ?? null, meta.ip, meta.userAgent);
  redirect("/portal");
}

/** Create a single-use trial-login link that opens the portal as this tenant. */
export async function createTrialLinkAction(
  _prev: PortalInviteState,
  fd: FormData,
): Promise<PortalInviteState> {
  await requireCapability("portal.impersonate");
  await assertModuleEnabled("tenantPortal");
  const tenantId = str(fd, "tenantId");
  if (!tenantId) return { error: "Missing tenant." };
  try {
    const actor = await auditActor();
    const raw = await createTrialToken(tenantId, actor.actorId ?? null, actor);
    const base = await publicBaseUrl();
    return {
      ok: true,
      message:
        "Trial login link created — single use, expires in 30 minutes. Open it (incognito works best) or send it to a tester.",
      link: `${base}/portal/trial/${raw}`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create trial link." };
  }
}
