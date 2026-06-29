import { describe, it, expect } from "vitest";
import { shouldSecureCookie } from "./secure-cookie";

describe("shouldSecureCookie", () => {
  it("trusts x-forwarded-proto when present (the proxy case)", () => {
    // The headline fix: a TLS-terminating proxy that left NODE_ENV unset still
    // gets a Secure cookie.
    expect(
      shouldSecureCookie({ forwardedProto: "https", host: "app.example.com", isProduction: false }),
    ).toBe(true);
    expect(
      shouldSecureCookie({ forwardedProto: "http", host: "app.example.com", isProduction: true }),
    ).toBe(false);
    // Comma list → first (client-facing) scheme wins.
    expect(
      shouldSecureCookie({ forwardedProto: "https, http", host: "app.example.com", isProduction: false }),
    ).toBe(true);
    expect(
      shouldSecureCookie({ forwardedProto: "HTTPS", host: "app.example.com", isProduction: false }),
    ).toBe(true);
  });

  it("never forces Secure on localhost without a proxy header (dev over http)", () => {
    expect(
      shouldSecureCookie({ forwardedProto: null, host: "localhost:3000", isProduction: true }),
    ).toBe(false);
    expect(
      shouldSecureCookie({ forwardedProto: null, host: "127.0.0.1:3000", isProduction: true }),
    ).toBe(false);
    // ...but a forwarded https header still wins even for a localhost host.
    expect(
      shouldSecureCookie({ forwardedProto: "https", host: "localhost:3000", isProduction: false }),
    ).toBe(true);
  });

  it("falls back to NODE_ENV for a direct (non-proxied) non-localhost host", () => {
    expect(
      shouldSecureCookie({ forwardedProto: null, host: "app.example.com", isProduction: true }),
    ).toBe(true);
    expect(
      shouldSecureCookie({ forwardedProto: null, host: "app.example.com", isProduction: false }),
    ).toBe(false);
    expect(
      shouldSecureCookie({ forwardedProto: null, host: null, isProduction: false }),
    ).toBe(false);
  });
});
