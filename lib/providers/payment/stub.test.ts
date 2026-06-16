import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { StubPaymentGateway } from "@/lib/providers/payment/stub";

const gateway = new StubPaymentGateway();
const SECRET = "whsec_test";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

const validBody = JSON.stringify({
  eventId: "evt_123",
  leaseId: "lease_abc",
  amountCents: 120000,
  reference: "ch_999",
  method: "card",
  occurredAt: "2026-06-16T10:00:00.000Z",
});

describe("StubPaymentGateway.parseWebhook", () => {
  it("parses a valid, correctly-signed event", () => {
    const event = gateway.parseWebhook({
      rawBody: validBody,
      signature: sign(validBody),
      secret: SECRET,
    });
    expect(event).toEqual({
      eventId: "evt_123",
      leaseId: "lease_abc",
      amountCents: 120000n,
      reference: "ch_999",
      method: "card",
      occurredAt: new Date("2026-06-16T10:00:00.000Z"),
    });
  });

  it("rejects a bad signature", () => {
    expect(
      gateway.parseWebhook({
        rawBody: validBody,
        signature: sign(validBody, "wrong"),
        secret: SECRET,
      }),
    ).toBeNull();
  });

  it("rejects a missing signature when a secret is configured", () => {
    expect(
      gateway.parseWebhook({ rawBody: validBody, signature: null, secret: SECRET }),
    ).toBeNull();
  });

  it("accepts without verification when no secret is configured (dev)", () => {
    const event = gateway.parseWebhook({
      rawBody: validBody,
      signature: null,
      secret: null,
    });
    expect(event?.eventId).toBe("evt_123");
  });

  it("returns null for malformed JSON", () => {
    expect(
      gateway.parseWebhook({ rawBody: "{not json", signature: null, secret: null }),
    ).toBeNull();
  });

  it("requires eventId and leaseId", () => {
    const body = JSON.stringify({ eventId: "e", amountCents: 100 });
    expect(
      gateway.parseWebhook({ rawBody: body, signature: null, secret: null }),
    ).toBeNull();
  });

  it("rejects non-positive amounts", () => {
    const body = JSON.stringify({ eventId: "e", leaseId: "l", amountCents: 0 });
    expect(
      gateway.parseWebhook({ rawBody: body, signature: null, secret: null }),
    ).toBeNull();
  });

  it("defaults method to 'online' and reference to the eventId", () => {
    const body = JSON.stringify({
      eventId: "evt_x",
      leaseId: "lease_y",
      amountCents: 5000,
    });
    const event = gateway.parseWebhook({ rawBody: body, signature: null, secret: null });
    expect(event?.method).toBe("online");
    expect(event?.reference).toBe("evt_x");
  });

  it("normalizes an unknown method to 'online'", () => {
    const body = JSON.stringify({
      eventId: "e",
      leaseId: "l",
      amountCents: 100,
      method: "crypto",
    });
    const event = gateway.parseWebhook({ rawBody: body, signature: null, secret: null });
    expect(event?.method).toBe("online");
  });

  it("accepts amountCents as a string of integer cents", () => {
    const body = JSON.stringify({ eventId: "e", leaseId: "l", amountCents: "2500" });
    const event = gateway.parseWebhook({ rawBody: body, signature: null, secret: null });
    expect(event?.amountCents).toBe(2500n);
  });
});
