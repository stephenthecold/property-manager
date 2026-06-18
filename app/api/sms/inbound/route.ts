import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { verifyTwilioSignature } from "@/lib/reminders/twilio-signature";
import { getEffectiveTwilioAuthToken } from "@/lib/services/app-settings";
import { setSmsConsentByPhone } from "@/lib/services/sms-consent";
import { recordInboundSms } from "@/lib/services/inbound-messages";
import { classifyKeyword } from "@/lib/sms/keywords";
import {
  SMS_HELP_REPLY,
  SMS_START_REPLY,
  SMS_STOP_REPLY,
} from "@/lib/sms/consent-text";

export const runtime = "nodejs";

/**
 * Inbound SMS webhook (A2P/10DLC opt-out compliance). Twilio POSTs here when a
 * tenant texts the number; we honor STOP/START/HELP. Authenticated by the
 * X-Twilio-Signature HMAC against the EFFECTIVE Twilio token (DB or env), never
 * a session. Fails closed when Twilio isn't the effective provider. Replies via
 * TwiML; always answers 200 (empty) on anything else so the provider doesn't
 * retry-storm.
 */

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(message: string | null): NextResponse {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params[key] = value;
    }

    // Fail closed unless Twilio is the effective provider AND the signature is valid.
    const token = await getEffectiveTwilioAuthToken();
    if (!token) return twiml(null);
    const env = getEnv();
    const ok = verifyTwilioSignature({
      authToken: token,
      url: `${env.APP_URL.replace(/\/+$/, "")}/api/sms/inbound`,
      params,
      signature: req.headers.get("x-twilio-signature") ?? "",
    });
    if (!ok) return new NextResponse(null, { status: 403 });

    const from = params["From"] ?? "";
    const keyword = classifyKeyword(params["Body"] ?? "");
    if (keyword === "none") {
      // Two-way SMS inbox: capture the reply for staff. Best-effort (never throws);
      // we do NOT auto-reply to inbound messages to avoid loops/cost.
      await recordInboundSms({
        fromPhone: params["From"] ?? "",
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
  } catch (e) {
    console.error(
      "[sms:inbound] webhook processing failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    return twiml(null);
  }
}
