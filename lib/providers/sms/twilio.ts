import type {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "@/lib/providers/sms/types";
import { getEnv } from "@/lib/config/env";

/**
 * Twilio implementation skeleton (Phase 3). Wired to env now so swapping providers
 * is config-only. The actual REST call is implemented in Phase 3; until then it
 * surfaces a clear "not implemented" rather than failing silently.
 */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  constructor() {
    const env = getEnv();
    if (!env.SMS_ACCOUNT_SID || !env.SMS_AUTH_TOKEN || !env.SMS_FROM_NUMBER) {
      throw new Error(
        "Twilio SMS requires SMS_ACCOUNT_SID, SMS_AUTH_TOKEN, and SMS_FROM_NUMBER.",
      );
    }
  }

  async send(_input: SendSmsInput): Promise<SendSmsResult> {
    // Phase 3: POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
    throw new Error("TwilioSmsProvider.send is implemented in Phase 3.");
  }
}
