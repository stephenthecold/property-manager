import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { verifyTwilioSignature } from "@/lib/reminders/twilio-signature";
import {
  getAppSettings,
  getEffectiveTwilioAuthToken,
} from "@/lib/services/app-settings";
import { setSmsConsentByPhone } from "@/lib/services/sms-consent";
import { classifyKeyword } from "@/lib/sms/keywords";

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
    if (keyword === "none") return twiml(null);

    const settings = await getAppSettings();
    const biz = settings.businessName;
    const actor = { actorType: "system" as const, actorEmail: "inbound SMS (opt-out)" };

    if (keyword === "stop") {
      await setSmsConsentByPhone(from, false, actor);
      return twiml(
        `You're unsubscribed from ${biz} texts. No more messages will be sent. Reply START to resubscribe.`,
      );
    }
    if (keyword === "start") {
      await setSmsConsentByPhone(from, true, actor);
      return twiml(
        `You're resubscribed to ${biz} texts. Reply HELP for help, STOP to unsubscribe.`,
      );
    }
    // help
    const contact = settings.businessPhone ? ` Contact: ${settings.businessPhone}.` : "";
    return twiml(
      `${biz}: account texts (rent reminders & receipts). Msg frequency varies. Msg & data rates may apply. Reply STOP to unsubscribe.${contact}`,
    );
  } catch (e) {
    console.error(
      "[sms:inbound] webhook processing failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    return twiml(null);
  }
}
