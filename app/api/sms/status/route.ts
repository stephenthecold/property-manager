import { NextResponse } from "next/server";
import { getEnv } from "@/lib/config/env";
import { verifyTwilioSignature } from "@/lib/reminders/twilio-signature";
import { getEffectiveTwilioAuthToken } from "@/lib/services/app-settings";
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
    // Authenticate against the EFFECTIVE Twilio token (DB or env), like the
    // inbound webhook — otherwise a DB-configured Twilio drops status callbacks.
    // With any other provider (stub default) there is NO legitimate caller of
    // this public endpoint, so the body is ignored entirely.
    const token = await getEffectiveTwilioAuthToken();
    if (!token) {
      return new NextResponse(null, { status: 204 });
    }
    const env = getEnv();
    const ok = verifyTwilioSignature({
      authToken: token,
      url: `${env.APP_URL.replace(/\/+$/, "")}/api/sms/status`,
      params,
      signature: req.headers.get("x-twilio-signature") ?? "",
    });
    if (!ok) return new NextResponse(null, { status: 403 });

    const messageSid = params["MessageSid"];
    const messageStatus = params["MessageStatus"];
    if (messageSid && messageStatus) {
      await recordDeliveryStatus(messageSid, messageStatus, {
        errorCode: params["ErrorCode"],
        errorMessage: params["ErrorMessage"],
      });
    }
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    // Log only the error message, never the raw webhook payload/object.
    console.error(
      "[sms:status] webhook processing failed:",
      e instanceof Error ? e.message : "unknown error",
    );
    return new NextResponse(null, { status: 204 });
  }
}
