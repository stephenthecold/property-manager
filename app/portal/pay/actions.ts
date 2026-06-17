"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { publicBaseUrl } from "@/lib/http/base-url";
import { requirePortalSession } from "@/lib/portal/session";
import { startCheckout, completeStubCheckout } from "@/lib/services/gateway-checkout";

/**
 * Tenant-initiated "Pay now". Re-checks the portal session and that the tenant
 * is on the lease, then asks the gateway to start a checkout and redirects the
 * payer there. The stub returns an in-app dev confirm page.
 */
export async function startPortalCheckoutAction(fd: FormData): Promise<void> {
  const { tenant } = await requirePortalSession();
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
  });
  if (!url) redirect("/portal?payerror=unavailable");
  redirect(url);
}

/** Complete the stub's dev-simulated checkout (records the payment). */
export async function completePortalCheckoutAction(fd: FormData): Promise<void> {
  const { tenant } = await requirePortalSession();
  const token = String(fd.get("token") ?? "").trim();
  if (!token) redirect("/portal?payerror=1");

  const res = await completeStubCheckout({ token, tenantId: tenant.id });
  if (res.status === "recorded" || res.status === "duplicate") {
    redirect("/portal?paid=1");
  }
  redirect("/portal?payerror=1");
}
