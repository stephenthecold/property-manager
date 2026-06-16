import { prisma } from "@/lib/db";
import { postPayment } from "@/lib/services/payments";
import type { AuditContext } from "@/lib/audit/audit";
import type { GatewayPaymentEvent } from "@/lib/providers/payment/types";

/**
 * Bridge a verified gateway webhook event into the LEDGER via the existing
 * payment service. No new balance math: postPayment does FIFO allocation,
 * idempotency, audit, and receipt creation. Idempotency is keyed by the
 * provider event id, so replaying the same webhook is a no-op.
 */

export type RecordGatewayStatus =
  | "recorded"
  | "duplicate"
  | "lease_not_found";

export interface RecordGatewayResult {
  status: RecordGatewayStatus;
  paymentId?: string;
}

export async function recordGatewayPayment(
  gatewayName: string,
  event: GatewayPaymentEvent,
): Promise<RecordGatewayResult> {
  const lease = await prisma.lease.findUnique({
    where: { id: event.leaseId },
    select: { id: true },
  });
  if (!lease) return { status: "lease_not_found" };

  const actor: AuditContext = {
    actorType: "system",
    actorEmail: `payment gateway (${gatewayName})`,
    actorId: null,
  };

  const res = await postPayment({
    leaseId: event.leaseId,
    amountCents: event.amountCents,
    paymentDate: event.occurredAt,
    method: event.method,
    referenceNumber: event.reference,
    notes: `Online payment via ${gatewayName}`,
    // Provider-event-scoped key: a replayed webhook converges to one payment.
    idempotencyKey: `gateway:${gatewayName}:${event.eventId}`,
    actor,
  });

  return {
    status: res.alreadyExisted ? "duplicate" : "recorded",
    paymentId: res.paymentId,
  };
}
