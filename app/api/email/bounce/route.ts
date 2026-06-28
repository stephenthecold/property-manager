import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { verifyBounceSignature } from "@/lib/email/bounce-signature";
import { parseBouncePayload } from "@/lib/reminders/suppression";
import { applyEmailBounce } from "@/lib/services/email-suppression";
import type { AuditContext } from "@/lib/audit/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email bounce / spam-complaint webhook (PUBLIC — authenticated by a shared
 * secret, NOT a session; the provider cannot log in). Mirrors the payment-gateway
 * webhook (app/api/payments/webhook): the sender signs the RAW body with
 * HMAC-SHA256(EMAIL_WEBHOOK_SECRET) (hex) in a header, and we verify it in
 * constant time over the exact bytes we received.
 *
 * SECURITY — never trusts the payload:
 *  - FAILS CLOSED: with no EMAIL_WEBHOOK_SECRET configured there is no legitimate
 *    caller, so every request is rejected (503) and the body is never parsed.
 *  - A bad/absent signature is rejected (401); we never suppress a tenant from an
 *    unauthenticated request.
 *  - Only a hard bounce / complaint (parseBouncePayload) acts; soft bounces and
 *    other event types are ignored.
 *  - Idempotent (applyEmailBounce), and 2xx ack regardless of whether the address
 *    matched a tenant — we reveal nothing about which addresses exist.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const secret = getEnv().EMAIL_WEBHOOK_SECRET ?? null;
  if (!secret) {
    console.warn(
      "[email/bounce] EMAIL_WEBHOOK_SECRET is not configured; rejecting webhook",
    );
    return NextResponse.json(
      { ok: false, error: "email webhook not configured" },
      { status: 503 },
    );
  }

  // Read the RAW body once and verify the signature over those exact bytes
  // (parsing first would let a body re-serialize differently from what was signed).
  const rawBody = await req.text();
  const signature =
    req.headers.get("x-email-signature") ??
    req.headers.get("x-webhook-signature") ??
    req.headers.get("x-mailgun-signature") ??
    req.headers.get("signature");

  if (!verifyBounceSignature({ secret, rawBody, signature })) {
    return NextResponse.json({ ok: false, error: "unverified" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Authenticated but malformed JSON — ack so the provider doesn't retry-storm.
    return NextResponse.json({ ok: false, error: "bad payload" }, { status: 400 });
  }

  // Untrusted → validated {email, status}. Non-suppressing events (soft bounce,
  // delivered, …) and missing emails parse to null and are a clean no-op ack.
  const event = parseBouncePayload(payload);
  if (!event) {
    return NextResponse.json({ ok: true, status: "ignored" });
  }

  try {
    const actor: AuditContext = {
      actorType: "system",
      actorEmail: `email bounce (${event.status})`,
    };
    const result = await applyEmailBounce(event.email, event.status, actor);
    // Ack 200 (no provider retry) without revealing whether the address matched
    // a tenant — an enumeration oracle otherwise. Counts are logged, not returned.
    if (result.matched === 0) {
      console.warn(
        `[email/bounce] verified ${event.status} for an unknown address; ignored`,
      );
    }
    return NextResponse.json({ ok: true, status: "processed" });
  } catch (e) {
    // Never leak internals to the provider; log the message only (never the body).
    console.error(
      "[email/bounce] webhook processing failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
