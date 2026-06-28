/** One file attached to an outbound email (e.g. a rendered report). */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
  /** MIME type; defaults to application/octet-stream when omitted. */
  contentType?: string;
}

/** Swappable outbound-email provider (SMTP today; API providers later). */
export interface SendEmailInput {
  to: string;
  subject: string;
  text: string;
  /** Optional file attachments (scheduled report delivery). */
  attachments?: EmailAttachment[];
}

export interface SendEmailResult {
  provider: string;
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
