import { describe, it, expect } from "vitest";
import {
  DEFAULT_RECEIPT_PREFIX,
  formatReceiptNumber,
  nextSequenceFromNumbers,
  receiptDateKey,
  sanitizeReceiptPrefix,
} from "@/lib/accounting/receipts";

describe("receiptDateKey", () => {
  it("formats the calendar day in the property timezone", () => {
    expect(receiptDateKey(new Date("2026-06-09T12:00:00Z"), "America/Chicago")).toBe(
      "20260609",
    );
  });

  it("a UTC instant can be the previous calendar day in America/Chicago", () => {
    // 2026-06-09T03:00Z is 2026-06-08 22:00 CDT.
    const instant = new Date("2026-06-09T03:00:00Z");
    expect(receiptDateKey(instant, "UTC")).toBe("20260609");
    expect(receiptDateKey(instant, "America/Chicago")).toBe("20260608");
  });

  it("a late-evening local instant can be the next calendar day in UTC", () => {
    // 2026-06-09 23:30 CDT is 2026-06-10 04:30 UTC.
    const instant = new Date("2026-06-09T23:30:00-05:00");
    expect(receiptDateKey(instant, "America/Chicago")).toBe("20260609");
    expect(receiptDateKey(instant, "UTC")).toBe("20260610");
  });
});

describe("formatReceiptNumber", () => {
  it("zero-pads the sequence to 4 digits", () => {
    expect(formatReceiptNumber("20260609", 1)).toBe("RCT-20260609-0001");
    expect(formatReceiptNumber("20260609", 42)).toBe("RCT-20260609-0042");
    expect(formatReceiptNumber("20260609", 9999)).toBe("RCT-20260609-9999");
  });

  it("never truncates sequences past 9999", () => {
    expect(formatReceiptNumber("20260609", 10000)).toBe("RCT-20260609-10000");
    expect(formatReceiptNumber("20260609", 12345)).toBe("RCT-20260609-12345");
  });

  it("rejects non-positive or fractional sequences", () => {
    expect(() => formatReceiptNumber("20260609", 0)).toThrow();
    expect(() => formatReceiptNumber("20260609", -3)).toThrow();
    expect(() => formatReceiptNumber("20260609", 1.5)).toThrow();
  });
});

describe("nextSequenceFromNumbers", () => {
  it("starts at 1 when the day has no receipts", () => {
    expect(nextSequenceFromNumbers("20260609", [])).toBe(1);
  });

  it("returns max sequence for the day + 1, regardless of order", () => {
    expect(
      nextSequenceFromNumbers("20260609", [
        "RCT-20260609-0003",
        "RCT-20260609-0007",
        "RCT-20260609-0001",
      ]),
    ).toBe(8);
  });

  it("ignores other days and malformed numbers", () => {
    expect(
      nextSequenceFromNumbers("20260609", [
        "RCT-20260608-0099", // different day
        "RCT-20260609-00ab", // non-numeric tail
        "RCT-20260609-", // empty tail
        "RCT-20260609-0004-x", // trailing junk
        "garbage",
        "RCT-20260609-0002",
      ]),
    ).toBe(3);
  });

  it("continues past the 4-digit pad width", () => {
    expect(
      nextSequenceFromNumbers("20260609", [
        "RCT-20260609-9999",
        "RCT-20260609-12345",
      ]),
    ).toBe(12346);
  });

  it("round-trips with formatReceiptNumber across the 9999 boundary", () => {
    const numbers: string[] = [];
    let seq = nextSequenceFromNumbers("20260609", numbers);
    expect(seq).toBe(1);
    numbers.push(formatReceiptNumber("20260609", 9999));
    seq = nextSequenceFromNumbers("20260609", numbers);
    expect(seq).toBe(10000);
    numbers.push(formatReceiptNumber("20260609", seq));
    expect(nextSequenceFromNumbers("20260609", numbers)).toBe(10001);
  });
});

describe("sanitizeReceiptPrefix", () => {
  it("uppercases and strips non-alphanumerics", () => {
    expect(sanitizeReceiptPrefix("rct")).toBe("RCT");
    expect(sanitizeReceiptPrefix("New Edge!")).toBe("NEWEDGE");
    expect(sanitizeReceiptPrefix("a-b_c.1")).toBe("ABC1");
  });

  it("clamps to 8 characters", () => {
    expect(sanitizeReceiptPrefix("ABCDEFGHIJ")).toBe("ABCDEFGH");
  });

  it("falls back to the default for blank/garbage", () => {
    expect(sanitizeReceiptPrefix(null)).toBe(DEFAULT_RECEIPT_PREFIX);
    expect(sanitizeReceiptPrefix(undefined)).toBe(DEFAULT_RECEIPT_PREFIX);
    expect(sanitizeReceiptPrefix("   ")).toBe(DEFAULT_RECEIPT_PREFIX);
    expect(sanitizeReceiptPrefix("!!!")).toBe(DEFAULT_RECEIPT_PREFIX);
  });
});

describe("formatReceiptNumber with a custom prefix", () => {
  it("uses the sanitized prefix", () => {
    expect(formatReceiptNumber("20260609", 1, "NER")).toBe("NER-20260609-0001");
    expect(formatReceiptNumber("20260609", 7, "new edge")).toBe(
      "NEWEDGE-20260609-0007",
    );
  });

  it("defaults to RCT when no prefix is given", () => {
    expect(formatReceiptNumber("20260609", 1)).toBe("RCT-20260609-0001");
  });
});

describe("nextSequenceFromNumbers with a custom prefix", () => {
  it("only counts numbers under the same prefix", () => {
    const existing = [
      "NER-20260609-0005",
      "RCT-20260609-0009", // different prefix — ignored
      "NER-20260609-0002",
    ];
    expect(nextSequenceFromNumbers("20260609", existing, "NER")).toBe(6);
    // Switching the prefix restarts that prefix's day sequence at 1.
    expect(nextSequenceFromNumbers("20260609", existing, "ACME")).toBe(1);
  });
});
