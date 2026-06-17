import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import { getEnv } from "@/lib/config/env";
import { signCheckoutToken } from "@/lib/providers/payment/checkout-token";
import type {
  CheckoutInput,
  CheckoutResult,
  GatewayPaymentEvent,
  ParseWebhookInput,
  PaymentGateway,
} from "@/lib/providers/payment/types";

/** Methods a real gateway would report; anything else normalizes to "online". */
const GATEWAY_METHODS: readonly PaymentMethod[] = ["card", "ach", "online"];

/** Constant-time hex-HMAC comparison. */
function verifySignature(
  rawBody: string,
  signature: string | null,
  secret: string | null,
): boolean {
  // Fail closed: with no shared secret we cannot authenticate the sender, so we
  // reject rather than accept. A deployment that wants to accept gateway
  // webhooks must configure PAYMENT_WEBHOOK_SECRET (and sign requests with it).
  if (!secret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deterministic, API-free gateway for dev/QA. The webhook body is JSON:
 *   { eventId, leaseId, amountCents, reference?, method?, occurredAt? }
 * authenticated by a hex `HMAC-SHA256(secret, rawBody)` signature. A secret is
 * REQUIRED — with none configured the verifier fails closed and every event is
 * rejected. Returns null for anything malformed or unverified so the route
 * records nothing. No real charge is ever pulled — it only normalizes the event.
 */
export class StubPaymentGateway implements PaymentGateway {
  readonly name = "stub";

  parseWebhook(input: ParseWebhookInput): GatewayPaymentEvent | null {
    if (!verifySignature(input.rawBody, input.signature, input.secret)) {
      return null;
    }
    let data: unknown;
    try {
      data = JSON.parse(input.rawBody);
    } catch {
      return null;
    }
    if (!data || typeof data !== "object") return null;
    const o = data as Record<string, unknown>;

    const eventId = typeof o.eventId === "string" ? o.eventId.trim() : "";
    const leaseId = typeof o.leaseId === "string" ? o.leaseId.trim() : "";
    if (!eventId || !leaseId) return null;

    // amountCents is integer minor units from the provider (never a float).
    let amountCents: bigint;
    try {
      amountCents = BigInt(
        typeof o.amountCents === "number" || typeof o.amountCents === "string"
          ? o.amountCents
          : "x",
      );
    } catch {
      return null;
    }
    if (amountCents <= 0n) return null;

    const method = GATEWAY_METHODS.includes(o.method as PaymentMethod)
      ? (o.method as PaymentMethod)
      : "online";
    const reference =
      typeof o.reference === "string" && o.reference.trim()
        ? o.reference.trim()
        : eventId;
    const occurredAt =
      typeof o.occurredAt === "string" && !Number.isNaN(Date.parse(o.occurredAt))
        ? new Date(o.occurredAt)
        : new Date();

    return { eventId, leaseId, amountCents, reference, method, occurredAt };
  }

  /**
   * Dev-simulated hosted checkout: no real charge. Encodes the lease + amount in
   * an HMAC-signed token (keyed by the shared secret) and points the payer at an
   * in-app confirm page; "completing" there records a payment through the same
   * webhook→ledger service. Returns null with no secret configured (can't sign).
   * A real adapter replaces this with a provider API call returning a hosted URL.
   */
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult | null> {
    const secret = getEnv().PAYMENT_WEBHOOK_SECRET ?? null;
    if (!secret) return null;
    const nonce = randomBytes(12).toString("hex");
    const token = signCheckoutToken(
      { leaseId: input.leaseId, amountCents: input.amountCents.toString(), nonce },
      secret,
    );
    return { url: `/portal/pay/${token}`, reference: `stub_${nonce}` };
  }
}
