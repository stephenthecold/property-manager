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

/** A request to begin a payment (the OUTBOUND side of the gateway). */
export interface CheckoutInput {
  /** The lease to credit; carried through to the resulting webhook/event. */
  leaseId: string;
  /** Integer cents to collect. */
  amountCents: bigint;
  /** Where to send the payer after the checkout completes/cancels. */
  returnUrl: string;
}

export interface CheckoutResult {
  /** Where to send the payer — a provider-hosted page (or, for the stub, an
   * in-app dev confirm page). May be relative to the app. */
  url: string;
  /** The provider's checkout/session reference. */
  reference: string;
}

export interface PaymentGateway {
  readonly name: string;
  /**
   * Verify a webhook's signature and parse it into a normalized payment event.
   * Returns null when the signature is invalid or the event is not a completed
   * payment we should record — the route then acks without posting anything.
   */
  parseWebhook(input: ParseWebhookInput): GatewayPaymentEvent | null;
  /**
   * Begin a payment and return where to send the payer. Returns null when the
   * gateway can't start a checkout (e.g. the stub with no shared secret, or a
   * provider that's webhook-only). A real adapter calls its provider's API here
   * and returns the hosted-checkout URL; the provider later POSTs the webhook
   * that {@link parseWebhook} normalizes — so no new ledger path is introduced.
   */
  createCheckout(input: CheckoutInput): Promise<CheckoutResult | null>;
}
