import type {
  InboundEmailProvider,
  InboundPollResult,
  ParsedInboundEmail,
} from "@/lib/providers/inbound-email/types";

/**
 * Canned inbound-email provider for trying the inbox without a real mailbox
 * (Settings → Email inbox → provider "stub"). Yields a couple of fixed messages
 * with STABLE messageIds, so the recorder dedups them after the first poll — a
 * repeating poll never piles up duplicates. The invoice sample carries a
 * text/plain attachment so the stub OCR + expense-prefill path is exercised.
 */
export class StubInboundProvider implements InboundEmailProvider {
  readonly name = "stub";

  async poll(
    _opts: { limit: number },
    onMessage: (m: ParsedInboundEmail) => Promise<void>,
  ): Promise<InboundPollResult> {
    const now = new Date();
    const messages: ParsedInboundEmail[] = [
      {
        messageId: "stub-welcome@local",
        fromEmail: "concierge@example.com",
        fromName: "Inbox Demo",
        toAddress: "invoices@yourdomain.com",
        subject: "Your email inbox is working",
        text:
          "This is a sample message from the stub inbound-email provider.\n\n" +
          "Point Settings → Email inbox at your IMAP mailbox to capture real mail.",
        receivedAt: now,
        attachments: [],
      },
      {
        messageId: "stub-invoice@local",
        fromEmail: "billing@acme-plumbing.example",
        fromName: "Acme Plumbing",
        toAddress: "invoices@yourdomain.com",
        subject: "Invoice #1042 — water heater replacement",
        text: "Please find the attached invoice for the recent job.",
        receivedAt: now,
        attachments: [
          {
            filename: "invoice-1042.txt",
            contentType: "text/plain",
            content: Buffer.from(
              "ACME PLUMBING\nInvoice #1042\nDate: " +
                now.toISOString().slice(0, 10) +
                "\nWater heater replacement (labor + parts)\nTotal: $1,250.00\n",
              "utf8",
            ),
          },
        ],
      },
    ];

    let processed = 0;
    let failed = 0;
    for (const m of messages) {
      try {
        await onMessage(m);
        processed++;
      } catch {
        failed++;
      }
    }
    return { fetched: messages.length, processed, failed };
  }
}
