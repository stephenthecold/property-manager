import { randomUUID } from "node:crypto";
import type {
  EmailProvider,
  SendEmailInput,
  SendEmailResult,
} from "@/lib/providers/email/types";

/**
 * Logs the would-send message instead of sending. Lets operators exercise
 * email flows (receipts, tests) end-to-end before SMTP credentials exist,
 * mirroring StubSmsProvider.
 */
export class StubEmailProvider implements EmailProvider {
  readonly name = "stub";

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.info(
      `[email:stub] would send to ${input.to}: ${JSON.stringify(input.subject)}`,
    );
    return {
      provider: this.name,
      status: "sent",
      providerMessageId: `stub-${randomUUID()}`,
    };
  }
}
