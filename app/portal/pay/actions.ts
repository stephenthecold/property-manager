"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { publicBaseUrl } from "@/lib/http/base-url";
import { requirePortalSession } from "@/lib/portal/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { startCheckout, completeStubCheckout } from "@/lib/services/gateway-checkout";
import { reportSelfPayment } from "@/lib/services/payments";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";

/**
 * Tenant-facing payment actions. EVERY one re-checks the portal session and
 * scopes to a lease the signed-in tenant is actually on. Online pay + the
 * offline self-report are gated by the `payments` module; staff manual recording
 * (core ledger) is unaffected by that flag.
 */

/**
 * Tenant-initiated "Pay now" (online gateway). Re-checks the portal session and
 * lease membership, then asks the gateway to start a checkout and redirects the
 * payer there. The stub returns an in-app dev confirm page. ACH bank debit is
 * offered alongside card when the operator enabled it in the portal method
 * config (Stripe only).
 */
export async function startPortalCheckoutAction(fd: FormData): Promise<void> {
  const { tenant } = await requirePortalSession();
  const { modules, portalPaymentMethods } = await getAppSettings();
  if (!modules.payments) redirect("/portal?payerror=unavailable");
  const leaseId = String(fd.get("leaseId") ?? "").trim();
  if (!leaseId) redirect("/portal?payerror=1");

  // Scope: the tenant must be on this lease (primary or co-tenant).
  const lease = await prisma.lease.findFirst({
    where: {
      id: leaseId,
      OR: [
        { tenantId: tenant.id },
        { coTenants: { some: { tenantId: tenant.id } } },
      ],
    },
    select: { id: true },
  });
  if (!lease) redirect("/portal?payerror=1");

  let amountCents: bigint;
  try {
    amountCents = toCents(String(fd.get("amount") ?? ""));
  } catch {
    redirect("/portal?payerror=amount");
  }
  if (amountCents! <= 0n) redirect("/portal?payerror=amount");

  const url = await startCheckout({
    leaseId,
    amountCents: amountCents!,
    returnUrl: `${await publicBaseUrl()}/portal`,
    allowAch: portalPaymentMethods.ach,
  });
  if (!url) redirect("/portal?payerror=unavailable");
  redirect(url);
}

/** Complete the stub's dev-simulated checkout (records the payment). */
export async function completePortalCheckoutAction(fd: FormData): Promise<void> {
  const { tenant } = await requirePortalSession();
  const { modules } = await getAppSettings();
  if (!modules.payments) redirect("/portal?payerror=unavailable");
  const token = String(fd.get("token") ?? "").trim();
  if (!token) redirect("/portal?payerror=1");

  const res = await completeStubCheckout({ token, tenantId: tenant.id });
  if (res.status === "recorded" || res.status === "duplicate") {
    redirect("/portal?paid=1");
  }
  redirect("/portal?payerror=1");
}

export interface SelfReportState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Self-report methods the portal can accept, mapped to the PaymentMethod enum. */
const SELF_REPORT_METHODS: Record<string, PaymentMethod> = {
  cash_app: "cash_app",
  cash: "cash",
  ach: "ach",
};

/**
 * Tenant self-reports an OFFLINE payment ("I paid $X via CashApp/Cash/ACH").
 * Creates a PENDING Payment with NO ledger entry and NO allocation — the
 * tenant's balance is unchanged until staff confirm it. Gated by the payments
 * module AND the per-method config; scoped to a lease the tenant is on. Failures
 * are returned as state, never thrown.
 */
export async function reportSelfPaymentAction(
  _prev: SelfReportState,
  fd: FormData,
): Promise<SelfReportState> {
  const { tenant } = await requirePortalSession();
  const { modules, portalPaymentMethods, cashAppCashtag } = await getAppSettings();
  if (!modules.payments) {
    return { error: "Online payment reporting isn't available right now." };
  }

  const methodRaw = String(fd.get("method") ?? "").trim();
  const method = SELF_REPORT_METHODS[methodRaw];
  if (!method) return { error: "Choose how you paid." };
  // The operator must have enabled this method for the portal. Cash App also
  // needs a cashtag set (mirrors the portal's render gate) so we never accept a
  // "paid via Cash App" report for an org that can't actually receive it.
  const enabled =
    (method === "cash_app" && portalPaymentMethods.cashApp && !!cashAppCashtag) ||
    (method === "cash" && portalPaymentMethods.cash) ||
    (method === "ach" && portalPaymentMethods.ach);
  if (!enabled) return { error: "That payment method isn't accepted here." };

  const leaseId = String(fd.get("leaseId") ?? "").trim();
  if (!leaseId) return { error: "No active lease to report a payment for." };
  // Scope to a lease the tenant is on AND still active — never let a stale POST
  // self-report against an ended/terminated lease.
  const lease = await prisma.lease.findFirst({
    where: {
      id: leaseId,
      status: { in: ["active", "month_to_month"] },
      OR: [{ tenantId: tenant.id }, { coTenants: { some: { tenantId: tenant.id } } }],
    },
    select: { id: true },
  });
  if (!lease) return { error: "No active lease to report a payment for." };

  let amountCents: bigint;
  try {
    amountCents = toCents(String(fd.get("amount") ?? ""));
  } catch {
    return { error: "Enter a valid amount (e.g. 1200.00)." };
  }
  if (amountCents <= 0n) return { error: "Amount must be positive." };

  const reference = String(fd.get("referenceNumber") ?? "").trim() || null;

  try {
    await reportSelfPayment({
      leaseId: lease.id,
      amountCents,
      method,
      referenceNumber: reference,
      notes: "Tenant self-reported via portal",
      actor: { actorType: "system", actorEmail: "portal (tenant)" },
    });
  } catch {
    return { error: "We couldn't record that. Please try again." };
  }

  revalidatePath("/portal");
  return {
    ok: true,
    message:
      "Thanks — we recorded that you paid. Your property manager will confirm it, and your balance updates once they do.",
  };
}
