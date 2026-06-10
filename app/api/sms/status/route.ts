import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { verifyTwilioSignature } from "@/lib/reminders/twilio-signature";
import { recordDeliveryStatus } from "@/lib/services/reminders";

export const runtime = "nodejs";

/**
 * Twilio delivery-status callback. Authenticated by the X-Twilio-Signature
 * HMAC (when Twilio is configured), not by a session — Twilio cannot log in.
 * Always answers 204 on processing errors so the provider does not retry-storm.
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const form = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") params[key] = value;
    }

    // Only a signature-verified Twilio callback may mutate reminder state.
    // With any other provider (stub default) there is NO legitimate caller of
    // this public endpoint, so the body is ignored entirely — otherwise it
    // would be an unauthenticated mutation in the default configuration.
    const env = getEnv();
    if (env.SMS_PROVIDER !== "twilio" || !env.SMS_AUTH_TOKEN) {
      return new NextResponse(null, { status: 204 });
    }
    const ok = verifyTwilioSignature({
      authToken: env.SMS_AUTH_TOKEN,
      url: `${env.APP_URL.replace(/\/+$/, "")}/api/sms/status`,
      params,
      signature: req.headers.get("x-twilio-signature") ?? "",
    });
    if (!ok) return new NextResponse(null, { status: 403 });

    const messageSid = params["MessageSid"];
    const messageStatus = params["MessageStatus"];
    if (messageSid && messageStatus) {
      await recordDeliveryStatus(messageSid, messageStatus);
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[sms:status] webhook error:", e);
    return new NextResponse(null, { status: 204 });
  }
}
