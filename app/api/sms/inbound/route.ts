import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { verifyTwilioSignature } from "@/lib/reminders/twilio-signature";
import { verifyTelnyxSignature } from "@/lib/reminders/telnyx-signature";
import {
  getEffectiveTwilioAuthToken,
  getEffectiveTelnyxPublicKey,
} from "@/lib/services/app-settings";
import { setSmsConsentByPhone } from "@/lib/services/sms-consent";
import { recordInboundSms } from "@/lib/services/inbound-messages";
import { recordDeliveryStatus } from "@/lib/services/reminders";
import { parseTelnyxWebhook } from "@/lib/sms/telnyx-webhook";
import { classifyKeyword } from "@/lib/sms/keywords";
import {
  SMS_HELP_REPLY,
  SMS_START_REPLY,
  SMS_STOP_REPLY,
} from "@/lib/sms/consent-text";

export const runtime = "nodejs";

/**
 * Inbound SMS webhook + Telnyx delivery receipts (A2P/10DLC opt-out compliance).
 *
 * Two providers, ONE endpoint, dispatched by which signature is present:
 *  - TWILIO POSTs application/x-www-form-urlencoded, signed with the
 *    X-Twilio-Signature HMAC (verified against the effective Twilio auth token);
 *    inbound-only (Twilio delivery receipts go to /api/sms/status). We reply via
 *    TwiML for STOP/START/HELP.
 *  - TELNYX POSTs JSON, signed with Ed25519 (telnyx-signature-ed25519 +
 *    telnyx-timestamp), verified against the account PUBLIC key (Settings →
 *    Messaging). Telnyx sends BOTH inbound messages (message.received) AND
 *    delivery receipts (message.sent/finalized) to this one URL, so we dispatch
 *    on the parsed event kind. We do NOT reply to Telnyx inbound (Telnyx handles
 *    the STOP confirmation at the carrier level) — we only record consent/inbox.
 *
 * Authenticated by signature, never a session (providers can't log in). Fails
 * closed when neither provider is effective, and always answers 2xx on
 * processing errors so the provider doesn't retry-storm.
 */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** TwiML response (Twilio only). Empty <Response/> = "handled, no reply". */
function twiml(message: string | null): NextResponse {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/** 200 ack with no body — Telnyx just needs a 2xx to stop retrying. */
function ack(): NextResponse {
  return new NextResponse(null, { status: 200 });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Read the raw body ONCE: Telnyx signs the exact bytes, and the body can
    // only be consumed a single time.
    const rawBody = await req.text();
    const telnyxSignature = req.headers.get("telnyx-signature-ed25519");
    if (telnyxSignature) {
      return await handleTelnyx(rawBody, telnyxSignature, req.headers.get("telnyx-timestamp"));
    }
    return await handleTwilio(rawBody, req.headers.get("x-twilio-signature"));
  } catch (e) {
    console.error(
      "[sms:inbound] webhook processing failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    // Twilio-shaped default (harmless to Telnyx, which ignores the body on a 200).
    return twiml(null);
  }
}

/** Telnyx: verify Ed25519, then dispatch inbound message vs delivery receipt. */
async function handleTelnyx(
  rawBody: string,
  signature: string,
  timestamp: string | null,
): Promise<NextResponse> {
  const publicKey = await getEffectiveTelnyxPublicKey();
  if (!publicKey) {
    // Telnyx isn't the effective provider, or no public key is configured — we
    // cannot verify, so we mutate NOTHING. Ack so Telnyx doesn't retry a config
    // gap. (A real signed event will process once the key is set in Settings.)
    return ack();
  }
  const verified = verifyTelnyxSignature({
    publicKeyBase64: publicKey,
    payload: rawBody,
    signatureBase64: signature,
    timestamp: timestamp ?? "",
  });
  if (!verified) return new NextResponse(null, { status: 403 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return ack(); // signed but unparseable — nothing to do
  }
  const event = parseTelnyxWebhook(parsed);

  if (event.kind === "status") {
    // Delivery receipt → update the reminder row's status + failure reason.
    await recordDeliveryStatus(event.providerMessageId, event.status, {
      errorCode: event.errorCode,
      errorMessage: event.errorMessage,
    });
    return ack();
  }

  if (event.kind === "inbound") {
    const keyword = classifyKeyword(event.text);
    const actor = {
      actorType: "system" as const,
      actorEmail: "inbound SMS (Telnyx)",
    };
    if (keyword === "stop") {
      await setSmsConsentByPhone(event.from, false, actor);
    } else if (keyword === "start") {
      await setSmsConsentByPhone(event.from, true, actor);
    } else if (keyword === "none") {
      // Two-way inbox: capture the reply for staff. We never auto-reply to
      // inbound Telnyx messages (avoids loops/cost); HELP/STOP confirmations are
      // handled by Telnyx's own number-level opt-out.
      await recordInboundSms({
        fromPhone: event.from,
        body: event.text,
        providerSid: event.providerMessageId,
      });
    }
    return ack();
  }

  return ack(); // ignored event type
}

/** Twilio: verify HMAC, honor STOP/START/HELP with a TwiML reply. */
async function handleTwilio(
  rawBody: string,
  signature: string | null,
): Promise<NextResponse> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawBody)) params[key] = value;

  // Fail closed unless Twilio is the effective provider AND the signature is valid.
  const token = await getEffectiveTwilioAuthToken();
  if (!token) return twiml(null);
  const env = getEnv();
  const ok = verifyTwilioSignature({
    authToken: token,
    url: `${env.APP_URL.replace(/\/+$/, "")}/api/sms/inbound`,
    params,
    signature: signature ?? "",
  });
  if (!ok) return new NextResponse(null, { status: 403 });

  const from = params["From"] ?? "";
  const keyword = classifyKeyword(params["Body"] ?? "");
  if (keyword === "none") {
    // Two-way SMS inbox: capture the reply for staff. Best-effort (never throws);
    // we do NOT auto-reply to inbound messages to avoid loops/cost.
    await recordInboundSms({
      fromPhone: from,
      body: params["Body"] ?? "",
      providerSid: params["MessageSid"],
    });
    return twiml(null);
  }

  const actor = { actorType: "system" as const, actorEmail: "inbound SMS (opt-out)" };
  if (keyword === "stop") {
    await setSmsConsentByPhone(from, false, actor);
    return twiml(SMS_STOP_REPLY);
  }
  if (keyword === "start") {
    // Re-subscription is recorded with source inbound_sms_keyword.
    await setSmsConsentByPhone(from, true, actor);
    return twiml(SMS_START_REPLY);
  }
  // help
  return twiml(SMS_HELP_REPLY);
}
