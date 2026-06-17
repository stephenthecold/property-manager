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
  const secret = getEnv().PAYMENT_WEBHOOK_SECRET ?? null;

  // Fail closed: without a configured shared secret we cannot authenticate the
  // sender, so we never parse or post the untrusted body. (The gateway verifier
  // also rejects when secret is null; this is an explicit, logged signal.)
  if (!secret) {
    console.warn(
      "[payments/webhook] PAYMENT_WEBHOOK_SECRET is not configured; rejecting webhook",
    );
    return NextResponse.json(
      { ok: false, error: "gateway not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get("stripe-signature") ??
    req.headers.get("x-payment-signature") ??
    req.headers.get("x-webhook-signature");

  const event = gateway.parseWebhook({ rawBody, signature, secret });
  if (!event) {
    // Bad signature or an event we don't act on — record nothing.
    return NextResponse.json({ ok: false, error: "unverified" }, { status: 400 });
  }

  try {
    const result = await recordGatewayPayment(gateway.name, event);
    if (result.status === "lease_not_found") {
      // Ack with 200 (no provider retry) and reveal nothing about which leases
      // exist: a distinct 404 here would be a lease-enumeration oracle for a
      // signed-but-misrouted event. Log it for operator diagnosis instead.
      console.warn(
        `[payments/webhook] verified event ${event.eventId} references an unknown lease; ignored`,
      );
      return NextResponse.json({ ok: false, status: "ignored" });
    }
    return NextResponse.json({ ok: true, status: result.status });
  } catch (e) {
    // Never leak internals to the provider; log for diagnosis and let it retry.
    console.error("[payments/webhook] failed:", e);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
