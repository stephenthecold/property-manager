import type { PaymentMethod } from "@/lib/generated/prisma/enums";

/**
 * Swappable online-payment gateway (Phase 5). Mirrors the SmsProvider /
 * FileStorage seams: a `stub` ships today and a real adapter (Stripe-style)
 * slots in later behind this one interface. The gateway never touches the
 * ledger directly — it only verifies + normalizes a provider webhook into a
 * GatewayPaymentEvent, which the service layer posts through the EXISTING
 * payment service (FIFO allocation, idempotency, audit, receipt). No new
 * balance math.
 */

/** A verified, normalized "payment completed" event parsed from a webhook. */
export interface GatewayPaymentEvent {
  /** Provider's unique event/charge id — the idempotency key for the payment. */
  eventId: string;
  /** The lease to credit (carried through checkout metadata). */
  leaseId: string;
  /** Integer cents (provider sends minor units — never a float). */
  amountCents: bigint;
  /** Provider payment/charge reference, stored on the Payment row. */
  reference: string;
  /** Normalized method — typically "card" or "ach"; falls back to "online". */
  method: PaymentMethod;
  occurredAt: Date;
}

export interface ParseWebhookInput {
  rawBody: string;
  signature: string | null;
  /** Shared webhook secret (env only). Null disables verification (dev). */
  secret: string | null;
}

export interface PaymentGateway {
  readonly name: string;
  /**
   * Verify a webhook's signature and parse it into a normalized payment event.
   * Returns null when the signature is invalid or the event is not a completed
   * payment we should record — the route then acks without posting anything.
   */
  parseWebhook(input: ParseWebhookInput): GatewayPaymentEvent | null;
}
