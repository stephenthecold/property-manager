import { describe, it, expect } from "vitest";
import {
  absCents,
  bigintReplacer,
  fromCents,
  formatCurrency,
  maxCents,
  minCents,
  percentOfBps,
  serialize,
  sumCents,
  toCents,
  toMoneyDTO,
} from "@/lib/money";

describe("toCents", () => {
  it("parses plain and decimal strings", () => {
    expect(toCents("1250")).toBe(125000n);
    expect(toCents("1250.00")).toBe(125000n);
    expect(toCents("1250.5")).toBe(125050n);
    expect(toCents("0.01")).toBe(1n);
    expect(toCents("0.1")).toBe(10n);
  });

  it("strips currency symbols, commas, whitespace", () => {
    expect(toCents("$1,250.00")).toBe(125000n);
    expect(toCents("  1,000.50 ")).toBe(100050n);
  });

  it("handles negatives and explicit plus", () => {
    expect(toCents("-37.42")).toBe(-3742n);
    expect(toCents("+5.00")).toBe(500n);
  });

  it("accepts numbers", () => {
    expect(toCents(1250)).toBe(125000n);
    expect(toCents(0.05)).toBe(5n);
  });

  it("rejects more than two decimals and junk", () => {
    expect(() => toCents("1.234")).toThrow();
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("")).toThrow();
  });
});

describe("fromCents", () => {
  it("formats with two decimals", () => {
    expect(fromCents(125000n)).toBe("1250.00");
    expect(fromCents(5n)).toBe("0.05");
    expect(fromCents(-3742n)).toBe("-37.42");
    expect(fromCents(0n)).toBe("0.00");
  });
});

describe("percentOfBps (half-up, bigint)", () => {
  it("computes exact percentages", () => {
    expect(percentOfBps(120000n, 500)).toBe(6000n); // 5% of $1200 = $60
    expect(percentOfBps(120000n, 1000)).toBe(12000n); // 10%
  });
  it("rounds half-up", () => {
    expect(percentOfBps(150n, 100)).toBe(2n); // 1.5 -> 2
    expect(percentOfBps(149n, 100)).toBe(1n); // 1.49 -> 1
  });
  it("is sign-aware", () => {
    expect(percentOfBps(-120000n, 500)).toBe(-6000n);
  });
});

describe("helpers", () => {
  it("sum/abs/min/max", () => {
    expect(sumCents([1n, 2n, 3n])).toBe(6n);
    expect(sumCents([])).toBe(0n);
    expect(absCents(-5n)).toBe(5n);
    expect(maxCents(2n, 9n)).toBe(9n);
    expect(minCents(2n, 9n)).toBe(2n);
  });
});

describe("serialization", () => {
  it("renders bigint as string", () => {
    expect(serialize({ amount: 125000n })).toBe('{"amount":"125000"}');
    expect(bigintReplacer("k", 5n)).toBe("5");
    expect(bigintReplacer("k", "x")).toBe("x");
  });
  it("toMoneyDTO produces wire-safe shape", () => {
    const dto = toMoneyDTO(125000n, "USD");
    expect(dto.cents).toBe("125000");
    expect(dto.display).toContain("1,250");
  });
});

describe("formatCurrency", () => {
  it("formats USD", () => {
    expect(formatCurrency(125000n)).toContain("1,250.00");
  });
});
