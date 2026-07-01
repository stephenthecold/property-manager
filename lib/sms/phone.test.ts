import { describe, it, expect } from "vitest";
import { toE164, toE164ForSend } from "./phone";

describe("toE164", () => {
  it("adds +1 to a bare US 10-digit number (any formatting)", () => {
    expect(toE164("5551234567")).toBe("+15551234567");
    expect(toE164("(555) 123-4567")).toBe("+15551234567");
    expect(toE164("555.123.4567")).toBe("+15551234567");
    expect(toE164(" 555 123 4567 ")).toBe("+15551234567");
  });

  it("handles an 11-digit number with a leading country 1", () => {
    expect(toE164("15551234567")).toBe("+15551234567");
    expect(toE164("1 (555) 123-4567")).toBe("+15551234567");
  });

  it("keeps an already-E.164 number (stripping formatting), incl. non-US", () => {
    expect(toE164("+15551234567")).toBe("+15551234567");
    expect(toE164("+1 (555) 123-4567")).toBe("+15551234567");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("returns null for anything it can't confidently normalize", () => {
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
    expect(toE164("12345")).toBeNull(); // too short
    expect(toE164("2025551234567")).toBeNull(); // 13 digits, no +
    expect(toE164("+")).toBeNull();
    expect(toE164("+123")).toBeNull(); // too few digits for E.164
    expect(toE164("not a phone")).toBeNull();
  });
});

describe("toE164ForSend", () => {
  it("normalizes when possible", () => {
    expect(toE164ForSend("5551234567")).toBe("+15551234567");
  });

  it("falls back to the raw trimmed value so the provider can reject it", () => {
    expect(toE164ForSend("12345")).toBe("12345");
    expect(toE164ForSend("  weird-ext-101  ")).toBe("weird-ext-101");
  });

  it("returns null only when there's nothing to send to", () => {
    expect(toE164ForSend("")).toBeNull();
    expect(toE164ForSend(null)).toBeNull();
  });
});
