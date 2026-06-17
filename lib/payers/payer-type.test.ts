import { describe, expect, it } from "vitest";
import {
  PAYER_TYPES,
  isPayerType,
  parsePayerType,
  payerTypeLabel,
} from "@/lib/payers/payer-type";

describe("payer-type", () => {
  it("recognizes every known type and rejects others", () => {
    for (const t of PAYER_TYPES) expect(isPayerType(t)).toBe(true);
    expect(isPayerType("landlord")).toBe(false);
    expect(isPayerType("")).toBe(false);
  });

  it("parses a valid type and falls back otherwise", () => {
    expect(parsePayerType("employer")).toBe("employer");
    expect(parsePayerType("nope")).toBe("housing_authority");
    expect(parsePayerType(null)).toBe("housing_authority");
    expect(parsePayerType(undefined, "other")).toBe("other");
  });

  it("labels housing_authority readably", () => {
    expect(payerTypeLabel("housing_authority")).toBe("Housing authority");
    expect(payerTypeLabel("nonprofit")).toBe("Nonprofit");
  });

  it("lists housing_authority first (the primary HUD case)", () => {
    expect(PAYER_TYPES[0]).toBe("housing_authority");
  });
});
