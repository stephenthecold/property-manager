import { describe, expect, it } from "vitest";
import { emailKey, looksLikeEmail, phoneKey } from "@/lib/portal/identity";

describe("phoneKey", () => {
  it("matches formatted and bare US numbers to one key", () => {
    expect(phoneKey("+1 (555) 123-4567")).toBe("5551234567");
    expect(phoneKey("555.123.4567")).toBe("5551234567");
    expect(phoneKey("15551234567")).toBe("5551234567");
    expect(phoneKey("5551234567")).toBe("5551234567");
  });

  it("rejects empty and too-short values", () => {
    expect(phoneKey("")).toBeNull();
    expect(phoneKey(null)).toBeNull();
    expect(phoneKey("12345")).toBeNull();
  });

  it("keeps 7–10 digit numbers as-is", () => {
    expect(phoneKey("1234567")).toBe("1234567");
  });
});

describe("emailKey", () => {
  it("lowercases and trims", () => {
    expect(emailKey("  Jane@Example.COM ")).toBe("jane@example.com");
  });
  it("rejects empties and non-emails", () => {
    expect(emailKey("")).toBeNull();
    expect(emailKey("not-an-email")).toBeNull();
    expect(emailKey(null)).toBeNull();
  });
});

describe("looksLikeEmail", () => {
  it("splits identifiers by the presence of @", () => {
    expect(looksLikeEmail("a@b.c")).toBe(true);
    expect(looksLikeEmail("5551234567")).toBe(false);
  });
});
