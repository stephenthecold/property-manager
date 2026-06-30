import { describe, it, expect } from "vitest";
import {
  MANUAL_CHARGE_SPECS,
  MANUAL_CHARGE_CATEGORIES,
  isManualChargeCategory,
  signedManualAmountCents,
} from "./manual-charge";

describe("manual-charge category map", () => {
  it("maps deposits to balance-only adjustments (never revenue)", () => {
    for (const c of ["security_deposit", "pet_deposit", "other_charge"] as const) {
      expect(MANUAL_CHARGE_SPECS[c].entryType).toBe("adjustment");
      expect(MANUAL_CHARGE_SPECS[c].sign).toBe(1);
      expect(MANUAL_CHARGE_SPECS[c].countsAsRent).toBe(false);
    }
  });

  it("maps prorated rent to a real rent_charge that counts as rent", () => {
    expect(MANUAL_CHARGE_SPECS.prorated_rent.entryType).toBe("rent_charge");
    expect(MANUAL_CHARGE_SPECS.prorated_rent.sign).toBe(1);
    expect(MANUAL_CHARGE_SPECS.prorated_rent.countsAsRent).toBe(true);
  });

  it("maps credit/concession to a negative credit", () => {
    expect(MANUAL_CHARGE_SPECS.credit.entryType).toBe("credit");
    expect(MANUAL_CHARGE_SPECS.credit.sign).toBe(-1);
    expect(MANUAL_CHARGE_SPECS.credit.countsAsRent).toBe(false);
  });

  it("recognizes valid categories and rejects junk", () => {
    expect(MANUAL_CHARGE_CATEGORIES).toContain("security_deposit");
    expect(isManualChargeCategory("prorated_rent")).toBe(true);
    expect(isManualChargeCategory("payment")).toBe(false);
    expect(isManualChargeCategory("")).toBe(false);
  });
});

describe("signedManualAmountCents", () => {
  it("keeps charges positive and makes credits negative", () => {
    expect(signedManualAmountCents("security_deposit", 150000n)).toBe(150000n);
    expect(signedManualAmountCents("prorated_rent", 48387n)).toBe(48387n);
    expect(signedManualAmountCents("credit", 25000n)).toBe(-25000n);
  });

  it("rejects a non-positive magnitude", () => {
    expect(() => signedManualAmountCents("security_deposit", 0n)).toThrow(/greater than zero/);
    expect(() => signedManualAmountCents("credit", -1n)).toThrow(/greater than zero/);
  });
});
