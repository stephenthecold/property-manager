import { getEnv } from "@/lib/config/env";
import type { PaymentGateway } from "@/lib/providers/payment/types";
import { StubPaymentGateway } from "@/lib/providers/payment/stub";
import { StripePaymentGateway } from "@/lib/providers/payment/stripe";

export type { PaymentGateway, GatewayPaymentEvent } from "@/lib/providers/payment/types";

let cached: PaymentGateway | null = null;

/**
 * The configured online-payment gateway (stub by default), selected by
 * PAYMENT_GATEWAY. "stripe" is a real adapter (REST via fetch, no SDK).
 */
export function getPaymentGateway(): PaymentGateway {
  if (cached) return cached;
  const provider = getEnv().PAYMENT_GATEWAY;
  switch (provider) {
    case "stripe":
      cached = new StripePaymentGateway();
      break;
    case "stub":
    default:
      cached = new StubPaymentGateway();
  }
  return cached;
}

/** Test helper: clear the memoized gateway. */
export function resetPaymentGatewayCache(): void {
  cached = null;
}
