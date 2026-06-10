/** Swappable SMS provider (Twilio / Telnyx / SignalWire...). Phase 3 uses this. */
export interface SendSmsInput {
  to: string;
  body: string;
}

export interface SendSmsResult {
  provider: string;
  status: "queued" | "sent" | "failed";
  providerMessageId?: string;
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  send(input: SendSmsInput): Promise<SendSmsResult>;
  /** Optional delivery-status lookup, if the provider supports it. */
  getStatus?(providerMessageId: string): Promise<string>;
}
