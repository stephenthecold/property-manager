import type {
  SendSmsInput,
  SendSmsResult,
  SmsProvider,
} from "@/lib/providers/sms/types";

/**
 * Phase-1 default. Does not send anything externally — it logs the would-send
 * message and returns a synthetic id with status "queued". The Phase-3 reminder
 * service records the Reminder row regardless of provider, so reminder flows are
 * testable end-to-end with no credentials.
 */
export class StubSmsProvider implements SmsProvider {
  readonly name = "stub";

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    console.info(
      `[sms:stub] would send to ${input.to}: ${JSON.stringify(input.body)}`,
    );
    return {
      provider: this.name,
      status: "queued",
      providerMessageId: `stub-${input.to}-${input.body.length}`,
    };
  }
}
