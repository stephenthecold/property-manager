/**
 * Inbound-email provider seam (module "mailbox"). A provider connects to a
 * mailbox, hands each new message to a recorder, and marks it processed only
 * AFTER the recorder succeeds. Capture is best-effort: a per-message failure is
 * isolated and the message stays for the next poll (dedup on messageId makes a
 * re-poll harmless).
 *
 * Providers are used ONLY by the worker (lib/services/inbox-poll.ts) — never
 * imported by an app route, so the IMAP client and MIME parser never enter the
 * Next.js bundle.
 */

export interface InboundEmailAttachment {
  filename: string;
  contentType: string | null;
  content: Buffer;
}

export interface ParsedInboundEmail {
  /** RFC822 Message-ID (angle brackets stripped), or null when absent. */
  messageId: string | null;
  fromEmail: string;
  fromName: string | null;
  toAddress: string | null;
  subject: string | null;
  /** Plain-text body (or text derived from HTML); NEVER raw HTML. */
  text: string;
  receivedAt: Date;
  attachments: InboundEmailAttachment[];
}

export interface InboundPollResult {
  fetched: number;
  processed: number;
  failed: number;
}

export interface InboundEmailProvider {
  readonly name: string;
  /**
   * Fetch up to `limit` new messages and invoke `onMessage` for each, marking a
   * message processed only after `onMessage` resolves. Returns counts.
   */
  poll(
    opts: { limit: number },
    onMessage: (m: ParsedInboundEmail) => Promise<void>,
  ): Promise<InboundPollResult>;
}
