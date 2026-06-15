"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit/audit";
import { PaymentMethod } from "@/lib/generated/prisma/enums";
import { destroyPortalSession, requirePortalSession } from "@/lib/portal/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { createTenantRequest } from "@/lib/services/tenant-requests";
import { setTenantSmsConsent } from "@/lib/services/sms-consent";

/**
 * Tenant-side portal actions. EVERY mutation re-verifies the portal session
 * (the /portal prefix is public to the staff middleware) and only ever
 * touches the signed-in tenant's own records. Failures are returned as
 * state, never thrown.
 */

export interface PortalActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function signOutPortalAction(): Promise<void> {
  await destroyPortalSession();
  redirect("/portal/login");
}

/** Self-service payment preference on the tenant's own record. */
export async function savePaymentPreferenceAction(
  _prev: PortalActionState,
  fd: FormData,
): Promise<PortalActionState> {
  const { tenant } = await requirePortalSession();
  const raw = String(fd.get("method") ?? "").trim();
  const method = raw in PaymentMethod ? (raw as PaymentMethod) : null;

  await prisma.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: { preferredPaymentMethod: method },
    });
    await writeAudit(tx, {
      actorType: "system",
      action: "portal.payment_preference_updated",
      entityType: "Tenant",
      entityId: tenant.id,
      before: { preferredPaymentMethod: tenant.preferredPaymentMethod },
      after: { preferredPaymentMethod: method },
    });
  });
  revalidatePath("/portal");
  return {
    ok: true,
    message: method
      ? `Preference saved: ${method.replace(/_/g, " ")}.`
      : "Preference cleared.",
  };
}

/** Self-service SMS opt-in/out on the tenant's own record. */
export async function setSmsConsentAction(
  _prev: PortalActionState,
  fd: FormData,
): Promise<PortalActionState> {
  const { tenant } = await requirePortalSession();
  const consent = fd.get("smsConsent") === "on";
  await setTenantSmsConsent(tenant.id, consent, {
    actorType: "system",
    actorEmail: "portal (tenant)",
  });
  revalidatePath("/portal");
  return {
    ok: true,
    message: consent
      ? "You're opted in — we may text you account messages."
      : "You're opted out — we won't text you.",
  };
}

/** "I'll pay cash" — opens a pickup request and alerts opted-in managers. */
export async function requestCashPickupAction(
  _prev: PortalActionState,
  fd: FormData,
): Promise<PortalActionState> {
  const { tenant } = await requirePortalSession();
  const leaseId = String(fd.get("leaseId") ?? "").trim() || null;
  const note = String(fd.get("note") ?? "");

  // Only a lease the tenant is actually on can ride along on the request.
  const lease = leaseId
    ? await prisma.lease.findFirst({
        where: {
          id: leaseId,
          OR: [{ tenantId: tenant.id }, { coTenants: { some: { tenantId: tenant.id } } }],
        },
        select: { id: true },
      })
    : null;

  const result = await createTenantRequest({
    tenantId: tenant.id,
    leaseId: lease?.id ?? null,
    type: "cash_pickup",
    message: note,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/portal");
  return {
    ok: true,
    message:
      "Pickup request sent — your property manager has been notified and will arrange a time.",
  };
}

/** Maintenance request → staff queue (and convertible to a job). */
export async function submitMaintenanceRequestAction(
  _prev: PortalActionState,
  fd: FormData,
): Promise<PortalActionState> {
  const { tenant } = await requirePortalSession();
  const { modules } = await getAppSettings();
  if (!modules.maintenance) {
    return { error: "Maintenance requests aren't available right now." };
  }
  const leaseId = String(fd.get("leaseId") ?? "").trim() || null;
  const message = String(fd.get("message") ?? "");

  const lease = leaseId
    ? await prisma.lease.findFirst({
        where: {
          id: leaseId,
          OR: [{ tenantId: tenant.id }, { coTenants: { some: { tenantId: tenant.id } } }],
        },
        select: { id: true },
      })
    : null;

  const result = await createTenantRequest({
    tenantId: tenant.id,
    leaseId: lease?.id ?? null,
    type: "maintenance",
    message,
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/portal");
  return {
    ok: true,
    message: "Request submitted — you can track its status below.",
  };
}
