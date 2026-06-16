import { getEnv } from "@/lib/config/env";
import type { PaymentGateway } from "@/lib/providers/payment/types";
import { StubPaymentGateway } from "@/lib/providers/payment/stub";

export type { PaymentGateway, GatewayPaymentEvent } from "@/lib/providers/payment/types";

let cached: PaymentGateway | null = null;

/**
 * The configured online-payment gateway (stub by default). A real adapter
 * (Stripe-style) registers here, selected by PAYMENT_GATEWAY.
 */
export function getPaymentGateway(): PaymentGateway {
  if (cached) return cached;
  const provider = getEnv().PAYMENT_GATEWAY;
  switch (provider) {
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
