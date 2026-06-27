import { describe, it, expect } from "vitest";
import {
  computeDisposition,
  validateDeductions,
} from "@/lib/accounting/deposit-disposition";

const ded = (label: string, cents: bigint) => ({ label, amountCents: cents });

describe("computeDisposition", () => {
  it("deposit fully covers balance + damages -> refund the excess", () => {
    // owes 200 rent, 300 damages, holds 1000 deposit
    const r = computeDisposition({
      balanceCents: 20000n,
      depositHeldCents: 100000n,
      deductions: [ded("Carpet", 30000n)],
    });
    expect(r.damagesTotalCents).toBe(30000n);
    expect(r.claimCents).toBe(50000n);
    expect(r.depositAppliedCents).toBe(50000n);
    expect(r.balanceOwedCents).toBe(0n);
    expect(r.refundDueCents).toBe(50000n); // 1000 - 500
  });

  it("deposit partially covers -> tenant still owes, no refund", () => {
    // owes 800 rent, 700 damages, holds 1000 deposit -> claim 1500
    const r = computeDisposition({
      balanceCents: 80000n,
      depositHeldCents: 100000n,
      deductions: [ded("Wall repair", 50000n), ded("Cleaning", 20000n)],
    });
    expect(r.damagesTotalCents).toBe(70000n);
    expect(r.claimCents).toBe(150000n);
    expect(r.depositAppliedCents).toBe(100000n);
    expect(r.balanceOwedCents).toBe(50000n); // 1500 - 1000
    expect(r.refundDueCents).toBe(0n);
  });

  it("deposit exactly covers -> zero owed, zero refund", () => {
    const r = computeDisposition({
      balanceCents: 0n,
      depositHeldCents: 30000n,
      deductions: [ded("Paint", 30000n)],
    });
    expect(r.depositAppliedCents).toBe(30000n);
    expect(r.balanceOwedCents).toBe(0n);
    expect(r.refundDueCents).toBe(0n);
  });

  it("clean move-out (no balance, no damages) -> full deposit refund", () => {
    const r = computeDisposition({ balanceCents: 0n, depositHeldCents: 120000n, deductions: [] });
    expect(r.damagesTotalCents).toBe(0n);
    expect(r.depositAppliedCents).toBe(0n);
    expect(r.balanceOwedCents).toBe(0n);
    expect(r.refundDueCents).toBe(120000n);
  });

  it("standing tenant credit increases the refund beyond the deposit", () => {
    // tenant has a 150 credit (balance -150), no damages, holds 1000 deposit
    const r = computeDisposition({ balanceCents: -15000n, depositHeldCents: 100000n, deductions: [] });
    expect(r.claimCents).toBe(-15000n);
    expect(r.depositAppliedCents).toBe(0n);
    expect(r.balanceOwedCents).toBe(0n);
    expect(r.refundDueCents).toBe(115000n); // 1000 deposit + 150 credit
  });

  it("damages with no held deposit -> full damages owed", () => {
    const r = computeDisposition({ balanceCents: 0n, depositHeldCents: 0n, deductions: [ded("Door", 25000n)] });
    expect(r.depositAppliedCents).toBe(0n);
    expect(r.balanceOwedCents).toBe(25000n);
    expect(r.refundDueCents).toBe(0n);
  });

  it("ignores non-positive deduction lines in the total", () => {
    const r = computeDisposition({
      balanceCents: 0n,
      depositHeldCents: 100000n,
      deductions: [ded("A", 10000n), ded("bogus", 0n), ded("neg", -5000n)],
    });
    expect(r.damagesTotalCents).toBe(10000n);
  });
});

describe("validateDeductions", () => {
  it("accepts positive labeled lines", () => {
    expect(validateDeductions([ded("Carpet", 10000n)])).toEqual({ ok: true });
  });
  it("rejects a blank label", () => {
    expect(validateDeductions([ded("  ", 10000n)]).ok).toBe(false);
  });
  it("rejects a non-positive amount", () => {
    expect(validateDeductions([ded("Carpet", 0n)]).ok).toBe(false);
    expect(validateDeductions([ded("Carpet", -1n)]).ok).toBe(false);
  });
});
