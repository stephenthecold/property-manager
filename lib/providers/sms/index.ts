import { getEnv } from "@/lib/config/env";
import type { SmsProvider } from "@/lib/providers/sms/types";
import { StubSmsProvider } from "@/lib/providers/sms/stub";
import { TelnyxSmsProvider } from "@/lib/providers/sms/telnyx";
import { TwilioSmsProvider } from "@/lib/providers/sms/twilio";

export type { SmsProvider } from "@/lib/providers/sms/types";

let cached: SmsProvider | null = null;

/** Returns the configured SMS provider (stub by default). */
export function getSmsProvider(): SmsProvider {
  if (cached) return cached;
  const provider = getEnv().SMS_PROVIDER;
  switch (provider) {
    case "twilio":
      cached = new TwilioSmsProvider();
      break;
    case "telnyx":
      cached = new TelnyxSmsProvider();
      break;
    default:
      cached = new StubSmsProvider();
  }
  return cached;
}
