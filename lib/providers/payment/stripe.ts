import { getEnv } from "@/lib/config/env";
import { verifyStripeSignature } from "@/lib/providers/payment/stripe-signature";
import type {
  CheckoutInput,
  CheckoutResult,
  GatewayPaymentEvent,
  ParseWebhookInput,
  PaymentGateway,
} from "@/lib/providers/payment/types";

/**
 * Real Stripe adapter behind the same gateway seam (no SDK — REST via fetch,
 * like the Twilio provider). Inbound: verify the `Stripe-Signature` header
 * (PAYMENT_WEBHOOK_SECRET = the endpoint's `whsec_...`) and normalize a PAID
 * Checkout Session into a GatewayPaymentEvent — the service layer posts it
 * through the EXISTING payment service (FIFO, audit, receipt; idempotent on the
 * Stripe event id). Two session events are honored, both carrying a session
 * object: `checkout.session.completed` (synchronous methods like card settle
 * immediately, payment_status="paid") and `checkout.session.async_payment_succeeded`
 * (ACH/us_bank_account debits settle days later — the original `completed` event
 * arrives unpaid and is intentionally ignored, then THIS event fires "paid").
 * Idempotency is keyed by the Stripe event id, so card and ACH each post exactly
 * once. Outbound: createCheckout creates a Checkout Session with STRIPE_SECRET_KEY
 * and returns the hosted-checkout URL. No new ledger math.
 *
 * Setup: PAYMENT_GATEWAY=stripe, STRIPE_SECRET_KEY=sk_..., and point a Stripe
 * webhook at /api/payments/webhook (signing secret in PAYMENT_WEBHOOK_SECRET)
 * subscribed to `checkout.session.completed` AND — if ACH is offered —
 * `checkout.session.async_payment_succeeded` (a failed ACH debit surfaces as
 * `checkout.session.async_payment_failed`, which is ignored: nothing posted, so
 * nothing to reverse).
 */

const STRIPE_API = "https://api.stripe.com/v1";

/** Stripe session events we treat as "a Checkout Session may have collected
 *  payment". The payment_status guard below still requires it to be paid. */
const RECORDABLE_SESSION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

/**
 * Normalize a verified Stripe event into a GatewayPaymentEvent, or null when it
 * isn't a paid checkout we should record. Pure — exported for unit testing.
 */
export function parseStripeEvent(json: unknown): GatewayPaymentEvent | null {
  if (!json || typeof json !== "object") return null;
  const ev = json as Record<string, unknown>;
  if (typeof ev.type !== "string" || !RECORDABLE_SESSION_EVENTS.has(ev.type)) {
    return null;
  }
  const eventId = typeof ev.id === "string" ? ev.id : "";
  if (!eventId) return null;

  const data = ev.data as Record<string, unknown> | undefined;
  const obj = data?.object as Record<string, unknown> | undefined;
  if (!obj) return null;
  // Only a session that actually collected payment. For ACH the `completed`
  // event is "unpaid"/"processing" and is dropped here; the later
  // async_payment_succeeded event arrives "paid" and posts.
  if (obj.payment_status != null && obj.payment_status !== "paid") return null;

  const metadata = (obj.metadata as Record<string, unknown> | undefined) ?? {};
  const leaseId =
    typeof metadata.leaseId === "string"
      ? metadata.leaseId
      : typeof obj.client_reference_id === "string"
        ? obj.client_reference_id
        : "";
  if (!leaseId) return null;

  let amountCents: bigint;
  try {
    const raw = obj.amount_total;
    amountCents = BigInt(typeof raw === "number" || typeof raw === "string" ? raw : "x");
  } catch {
    return null;
  }
  if (amountCents <= 0n) return null;

  const reference =
    typeof obj.payment_intent === "string"
      ? obj.payment_intent
      : typeof obj.id === "string"
        ? obj.id
        : eventId;
  const createdSec = typeof ev.created === "number" ? ev.created : null;

  // Attribution only (never affects allocation/balance): a bank-debit-only
  // session is recorded as "ach"; anything else (incl. a card+ACH session where
  // the bare event can't tell which was used) stays "card".
  const methodTypes = Array.isArray(obj.payment_method_types)
    ? (obj.payment_method_types as unknown[]).filter(
        (t): t is string => typeof t === "string",
      )
    : [];
  const method: GatewayPaymentEvent["method"] =
    methodTypes.includes("us_bank_account") && !methodTypes.includes("card")
      ? "ach"
      : "card";

  return {
    eventId,
    leaseId,
    amountCents,
    reference,
    method,
    occurredAt: createdSec ? new Date(createdSec * 1000) : new Date(),
  };
}

export class StripePaymentGateway implements PaymentGateway {
  readonly name = "stripe";

  parseWebhook(input: ParseWebhookInput): GatewayPaymentEvent | null {
    if (!input.secret) return null; // fail closed
    if (!verifyStripeSignature(input.rawBody, input.signature, input.secret)) {
      return null;
    }
    let json: unknown;
    try {
      json = JSON.parse(input.rawBody);
    } catch {
      return null;
    }
    return parseStripeEvent(json);
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult | null> {
    const key = getEnv().STRIPE_SECRET_KEY;
    if (!key) return null;
    const currency = (input.currency ?? "usd").toLowerCase();

    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${input.returnUrl}?paid=1`);
    params.set("cancel_url", input.returnUrl);
    params.set("client_reference_id", input.leaseId);
    params.set("metadata[leaseId]", input.leaseId);
    params.set("payment_intent_data[metadata][leaseId]", input.leaseId);
    // ACH bank debit alongside card when requested. Stripe collects it and
    // POSTs the SAME checkout.session.completed webhook → existing ledger path;
    // no new posting logic. Without this flag we leave payment_method_types
    // unset so the account's dashboard default (card) is unchanged.
    if (input.allowAch) {
      params.set("payment_method_types[0]", "card");
      params.set("payment_method_types[1]", "us_bank_account");
    }
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", currency);
    params.set("line_items[0][price_data][unit_amount]", input.amountCents.toString());
    params.set("line_items[0][price_data][product_data][name]", "Rent payment");

    let res: Response;
    try {
      res = await fetch(`${STRIPE_API}/checkout/sessions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
    } catch (e) {
      console.error("[stripe] createCheckout request failed:", e);
      return null;
    }
    if (!res.ok) {
      console.error(`[stripe] createCheckout failed: HTTP ${res.status}`);
      return null;
    }
    const session = (await res.json()) as { id?: string; url?: string };
    if (!session.url || !session.id) return null;
    return { url: session.url, reference: session.id };
  }
}
