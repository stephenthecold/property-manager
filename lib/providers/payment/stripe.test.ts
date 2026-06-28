import { describe, expect, it } from "vitest";
import { parseStripeEvent } from "@/lib/providers/payment/stripe";

function sessionEvent(over: Record<string, unknown> = {}, objOver: Record<string, unknown> = {}) {
  return {
    id: "evt_123",
    type: "checkout.session.completed",
    created: 1_700_000_000,
    data: {
      object: {
        id: "cs_test_1",
        payment_status: "paid",
        amount_total: 120000,
        payment_intent: "pi_abc",
        metadata: { leaseId: "lease_xyz" },
        ...objOver,
      },
    },
    ...over,
  };
}

describe("parseStripeEvent", () => {
  it("normalizes a paid checkout.session.completed", () => {
    expect(parseStripeEvent(sessionEvent())).toEqual({
      eventId: "evt_123",
      leaseId: "lease_xyz",
      amountCents: 120000n,
      reference: "pi_abc",
      method: "card",
      occurredAt: new Date(1_700_000_000 * 1000),
    });
  });

  it("falls back to client_reference_id for the lease", () => {
    const ev = sessionEvent({}, { metadata: {}, client_reference_id: "lease_ref" });
    expect(parseStripeEvent(ev)?.leaseId).toBe("lease_ref");
  });

  it("ignores non-checkout events", () => {
    expect(parseStripeEvent(sessionEvent({ type: "payment_intent.created" }))).toBeNull();
  });

  it("ignores an unpaid session", () => {
    expect(parseStripeEvent(sessionEvent({}, { payment_status: "unpaid" }))).toBeNull();
  });

  it("requires a lease id", () => {
    expect(parseStripeEvent(sessionEvent({}, { metadata: {} }))).toBeNull();
  });

  it("rejects a non-positive amount", () => {
    expect(parseStripeEvent(sessionEvent({}, { amount_total: 0 }))).toBeNull();
  });

  it("rejects junk", () => {
    expect(parseStripeEvent(null)).toBeNull();
    expect(parseStripeEvent({ type: "checkout.session.completed" })).toBeNull();
  });

  it("records a settled ACH async_payment_succeeded event", () => {
    // ACH settles days after checkout via this event; it must post (paid).
    const ev = sessionEvent(
      { id: "evt_ach", type: "checkout.session.async_payment_succeeded" },
      { payment_method_types: ["us_bank_account"], payment_status: "paid" },
    );
    expect(parseStripeEvent(ev)).toMatchObject({
      eventId: "evt_ach",
      leaseId: "lease_xyz",
      amountCents: 120000n,
      method: "ach",
    });
  });

  it("ignores the unpaid ACH checkout.session.completed (defers to settlement)", () => {
    const ev = sessionEvent(
      {},
      { payment_method_types: ["us_bank_account"], payment_status: "unpaid" },
    );
    expect(parseStripeEvent(ev)).toBeNull();
  });

  it("maps a bank-debit-only session to the ach method", () => {
    const ev = sessionEvent({}, { payment_method_types: ["us_bank_account"] });
    expect(parseStripeEvent(ev)?.method).toBe("ach");
  });

  it("keeps card when a session allows both card and bank debit", () => {
    // The bare session can't tell which was used, so stay conservative (card).
    const ev = sessionEvent({}, { payment_method_types: ["card", "us_bank_account"] });
    expect(parseStripeEvent(ev)?.method).toBe("card");
  });

  it("defaults to card when no payment_method_types are present", () => {
    expect(parseStripeEvent(sessionEvent())?.method).toBe("card");
  });
});
