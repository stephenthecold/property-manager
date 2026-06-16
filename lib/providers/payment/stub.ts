import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";
import type {
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
  if (!secret) return true; // dev: no secret configured -> accept
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deterministic, API-free gateway for dev/QA. The webhook body is JSON:
 *   { eventId, leaseId, amountCents, reference?, method?, occurredAt? }
 * authenticated by a hex `HMAC-SHA256(secret, rawBody)` signature when a secret
 * is configured. Returns null for anything malformed or unverified so the route
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
}
