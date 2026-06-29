import { describe, it, expect } from "vitest";
import { unsafeOutboundUrlReason } from "./safe-url";

describe("unsafeOutboundUrlReason", () => {
  it("allows real public https IdP token endpoints (host names)", () => {
    expect(
      unsafeOutboundUrlReason(
        "https://login.microsoftonline.com/t/oauth2/v2.0/token",
      ),
    ).toBeNull();
    expect(unsafeOutboundUrlReason("https://oauth2.googleapis.com/token")).toBeNull();
    expect(unsafeOutboundUrlReason("https://login.test/token")).toBeNull();
    expect(unsafeOutboundUrlReason("https://idp.example.co.uk:8443/token")).toBeNull();
  });

  it("rejects non-https and unparseable URLs", () => {
    expect(unsafeOutboundUrlReason("http://login.microsoftonline.com/token")).toMatch(
      /https/,
    );
    expect(unsafeOutboundUrlReason("ftp://example.com/x")).toMatch(/https/);
    expect(unsafeOutboundUrlReason("not a url")).toMatch(/valid URL/);
    expect(unsafeOutboundUrlReason("")).toMatch(/valid URL/);
  });

  it("rejects localhost and internal-suffix hostnames", () => {
    expect(unsafeOutboundUrlReason("https://localhost/token")).toMatch(/local/);
    expect(unsafeOutboundUrlReason("https://foo.localhost/token")).toMatch(/local/);
    expect(unsafeOutboundUrlReason("https://mail.internal/token")).toMatch(/local/);
    expect(unsafeOutboundUrlReason("https://printer.local/token")).toMatch(/local/);
  });

  it("rejects ALL IPv4 literals (a real token endpoint is a host name)", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.5.5",
      "192.168.0.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "8.8.8.8", // even a public IP literal is rejected — never legitimate here
    ]) {
      expect(unsafeOutboundUrlReason(`https://${ip}/token`)).toMatch(/IP address/);
    }
  });

  it("rejects IPv6 literals incl. loopback / ULA / link-local / IPv4-mapped", () => {
    for (const ip of [
      "[::1]",
      "[fc00::1]",
      "[fd12:3456::1]",
      "[fe80::1]",
      "[::ffff:127.0.0.1]", // IPv4-mapped (URL normalizes to hex — still caught)
      "[2606:4700::1111]", // even a public IPv6 literal is rejected
    ]) {
      expect(unsafeOutboundUrlReason(`https://${ip}/token`)).toMatch(/IP address/);
    }
  });
});
