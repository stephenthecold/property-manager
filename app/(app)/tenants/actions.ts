"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCapability, auditActor } from "@/lib/auth/session";
import { writeAudit, withAudit } from "@/lib/audit/audit";
import { PaymentMethod } from "@/lib/generated/prisma/enums";
import {
  invitePortalAccount,
  setPortalAccountActive,
} from "@/lib/services/portal-auth";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** "" → null; anything else must be a PaymentMethod enum value. */
function parsePreferredMethod(raw: string): PaymentMethod | null {
  return raw in PaymentMethod ? (raw as PaymentMethod) : null;
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
  const tenant = await prisma.tenant.create({
    data: {
      firstName,
      lastName,
      phone: str(fd, "phone") || null,
      email: str(fd, "email") || null,
      mailingAddress: str(fd, "mailingAddress") || null,
      emergencyContactName: str(fd, "emergencyContactName") || null,
      emergencyContactPhone: str(fd, "emergencyContactPhone") || null,
      smsConsent: fd.get("smsConsent") === "on",
      notes: str(fd, "notes") || null,
    },
  });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "tenant.created",
    entityType: "Tenant",
    entityId: tenant.id,
    after: { firstName, lastName },
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
    isActive: fd.get("isActive") === "on",
    preferredPaymentMethod: parsePreferredMethod(str(fd, "preferredPaymentMethod")),
    notes: str(fd, "notes") || null,
  };

  await withAudit(
    {
      ...(await auditActor()),
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
        isActive: tenant.isActive,
        preferredPaymentMethod: tenant.preferredPaymentMethod,
        notes: tenant.notes,
      },
    },
    async (tx) => {
      const updated = await tx.tenant.update({ where: { id: tenant.id }, data });
      return { result: updated, after: data };
    },
  );

  revalidatePath(`/tenants/${tenant.id}`);
  revalidatePath("/tenants");
  return { ok: true };
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
