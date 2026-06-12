import { describe, expect, it } from "vitest";
import { cashAppLink, normalizeCashtag } from "@/lib/payments/cash-app";

describe("normalizeCashtag", () => {
  it("canonicalizes with a single leading $", () => {
    expect(normalizeCashtag("NewEdgeRentals")).toBe("$NewEdgeRentals");
    expect(normalizeCashtag("$NewEdgeRentals")).toBe("$NewEdgeRentals");
    expect(normalizeCashtag("  $Tag1 ")).toBe("$Tag1");
  });

  it("rejects empty and malformed tags", () => {
    expect(normalizeCashtag("")).toBeNull();
    expect(normalizeCashtag(null)).toBeNull();
    expect(normalizeCashtag("$")).toBeNull();
    expect(normalizeCashtag("1starts-with-digit")).toBeNull();
    expect(normalizeCashtag("has spaces")).toBeNull();
    expect(normalizeCashtag("a".repeat(21))).toBeNull();
  });
});

describe("cashAppLink", () => {
  it("builds the cash.app URL from the canonical tag", () => {
    expect(cashAppLink("$NewEdgeRentals")).toBe(
      "https://cash.app/$NewEdgeRentals",
    );
  });
});
