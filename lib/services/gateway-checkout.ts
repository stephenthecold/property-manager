import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { sha256 } from "@/lib/auth/crypto";
import { getPaymentGateway } from "@/lib/providers/payment";
import { verifyCheckoutToken } from "@/lib/providers/payment/checkout-token";
import { recordGatewayPayment } from "@/lib/services/gateway-payments";

/**
 * Outbound "Pay now" flow. `startCheckout` asks the configured gateway for a
 * URL to send the payer to; `completeStubCheckout` finishes the STUB's
 * dev-simulated checkout by recording a payment through the SAME
 * webhook→ledger service (FIFO allocation, audit, receipt — no new balance
 * math). A real adapter needs none of `completeStubCheckout`: the provider
 * collects payment and POSTs /api/payments/webhook directly.
 */

/** Whether online "Pay now" can run (the stub needs the shared secret to sign). */
export function onlinePaymentsConfigured(): boolean {
  return !!getEnv().PAYMENT_WEBHOOK_SECRET;
}

/** Begin a checkout; returns where to send the payer, or null if unavailable. */
export async function startCheckout(input: {
  leaseId: string;
  amountCents: bigint;
  returnUrl: string;
  /** Offer ACH bank debit alongside card (Stripe only; ignored by the stub). */
  allowAch?: boolean;
}): Promise<string | null> {
  const res = await getPaymentGateway().createCheckout(input);
  return res?.url ?? null;
}

export type CompleteCheckoutStatus =
  | "recorded"
  | "duplicate"
  | "invalid"
  | "not_authorized";

/**
 * Complete a STUB checkout. Re-verifies the signed token server-side AND that
 * the paying tenant is actually on the lease the token names (defense in depth),
 * then records via the existing gateway→ledger service. Idempotent on a token-
 * derived event id, so re-confirming yields exactly one payment.
 */
export async function completeStubCheckout(input: {
  token: string;
  tenantId: string;
}): Promise<{ status: CompleteCheckoutStatus }> {
  const secret = getEnv().PAYMENT_WEBHOOK_SECRET ?? null;
  if (!secret) return { status: "invalid" };

  const claims = verifyCheckoutToken(input.token, secret);
  if (!claims) return { status: "invalid" };
  const amountCents = BigInt(claims.amountCents);
  if (amountCents <= 0n) return { status: "invalid" };

  // Scope: the signed-in tenant must be on this lease (primary or co-tenant).
  const lease = await prisma.lease.findFirst({
    where: {
      id: claims.leaseId,
      OR: [
        { tenantId: input.tenantId },
        { coTenants: { some: { tenantId: input.tenantId } } },
      ],
    },
    select: { id: true },
  });
  if (!lease) return { status: "not_authorized" };

  const res = await recordGatewayPayment(getPaymentGateway().name, {
    // Token-derived id → re-confirming the same checkout converges to one payment.
    eventId: `checkout:${sha256(input.token)}`,
    leaseId: claims.leaseId,
    amountCents,
    reference: `stub_${claims.nonce}`,
    method: "online",
    occurredAt: new Date(),
  });
  if (res.status === "duplicate") return { status: "duplicate" };
  if (res.status === "lease_not_found") return { status: "invalid" };
  return { status: "recorded" };
}
