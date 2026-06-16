import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { getPaymentGateway } from "@/lib/providers/payment";
import { recordGatewayPayment } from "@/lib/services/gateway-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Online-payment gateway webhook (public — authenticated by the provider
 * signature, not a session; added to auth.config PUBLIC_PREFIXES). The gateway
 * verifies + normalizes the event; a verified completed payment is posted
 * through the existing payment service (idempotent on the provider event id).
 */
export async function POST(req: Request): Promise<Response> {
  const gateway = getPaymentGateway();
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-payment-signature") ??
    req.headers.get("x-webhook-signature");
  const secret = getEnv().PAYMENT_WEBHOOK_SECRET ?? null;

  const event = gateway.parseWebhook({ rawBody, signature, secret });
  if (!event) {
    // Bad signature or an event we don't act on — record nothing.
    return NextResponse.json({ ok: false, error: "unverified" }, { status: 400 });
  }

  try {
    const result = await recordGatewayPayment(gateway.name, event);
    if (result.status === "lease_not_found") {
      return NextResponse.json({ ok: false, error: "lease_not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, status: result.status });
  } catch (e) {
    // Never leak internals to the provider; log for diagnosis and let it retry.
    console.error("[payments/webhook] failed:", e);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
