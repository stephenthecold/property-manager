import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import { StubPaymentGateway } from "@/lib/providers/payment/stub";

const gateway = new StubPaymentGateway();
const SECRET = "whsec_test";

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Parse a body, defaulting to a valid signature with SECRET so each test
 * exercises its own concern rather than the no-secret reject path. Pass an
 * explicit `secret`/`signature` to test authentication behavior.
 */
function parse(
  body: string,
  opts: { secret?: string | null; signature?: string | null } = {},
) {
  const secret = opts.secret === undefined ? SECRET : opts.secret;
  const signature =
    opts.signature === undefined
      ? secret
        ? sign(body, secret)
        : null
      : opts.signature;
  return gateway.parseWebhook({ rawBody: body, signature, secret });
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
    const event = parse(validBody);
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
    expect(parse(validBody, { signature: sign(validBody, "wrong") })).toBeNull();
  });

  it("rejects a missing signature when a secret is configured", () => {
    expect(parse(validBody, { signature: null })).toBeNull();
  });

  it("fails closed: rejects when no secret is configured", () => {
    // Even a well-formed body must be rejected without a shared secret — the
    // sender is unauthenticated, so the route records nothing.
    expect(parse(validBody, { secret: null, signature: null })).toBeNull();
    expect(parse(validBody, { secret: null, signature: sign(validBody) })).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parse("{not json")).toBeNull();
  });

  it("requires eventId and leaseId", () => {
    expect(parse(JSON.stringify({ eventId: "e", amountCents: 100 }))).toBeNull();
  });

  it("rejects non-positive amounts", () => {
    expect(
      parse(JSON.stringify({ eventId: "e", leaseId: "l", amountCents: 0 })),
    ).toBeNull();
  });

  it("defaults method to 'online' and reference to the eventId", () => {
    const event = parse(
      JSON.stringify({ eventId: "evt_x", leaseId: "lease_y", amountCents: 5000 }),
    );
    expect(event?.method).toBe("online");
    expect(event?.reference).toBe("evt_x");
  });

  it("normalizes an unknown method to 'online'", () => {
    const event = parse(
      JSON.stringify({ eventId: "e", leaseId: "l", amountCents: 100, method: "crypto" }),
    );
    expect(event?.method).toBe("online");
  });

  it("accepts amountCents as a string of integer cents", () => {
    const event = parse(
      JSON.stringify({ eventId: "e", leaseId: "l", amountCents: "2500" }),
    );
    expect(event?.amountCents).toBe(2500n);
  });
});
