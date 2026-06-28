import { describe, expect, it } from "vitest";
import {
  balanceImpactOfPayments,
  canConfirm,
  canReject,
  isBalanceAffecting,
  type ReportedPaymentLike,
} from "@/lib/accounting/payment-status";

describe("isBalanceAffecting", () => {
  it("only posted payments have a live balance-reducing ledger entry", () => {
    expect(isBalanceAffecting("posted")).toBe(true);
    expect(isBalanceAffecting("pending")).toBe(false);
    expect(isBalanceAffecting("voided")).toBe(false);
    expect(isBalanceAffecting("reversed")).toBe(false);
  });
});

describe("canConfirm / canReject", () => {
  it("a self-report can be confirmed or rejected only while pending", () => {
    expect(canConfirm("pending")).toBe(true);
    expect(canReject("pending")).toBe(true);
    for (const s of ["posted", "voided", "reversed"] as const) {
      expect(canConfirm(s)).toBe(false);
      expect(canReject(s)).toBe(false);
    }
  });
});

describe("balanceImpactOfPayments — the self-report invariant", () => {
  it("a pending self-reported payment contributes 0 to the balance", () => {
    const payments: ReportedPaymentLike[] = [
      { status: "pending", amountCents: 120000n }, // self-reported, not yet confirmed
    ];
    expect(balanceImpactOfPayments(payments)).toBe(0n);
  });

  it("confirming a self-report posts exactly its negative amount, once", () => {
    const before: ReportedPaymentLike[] = [{ status: "pending", amountCents: 120000n }];
    const afterConfirm: ReportedPaymentLike[] = [{ status: "posted", amountCents: 120000n }];
    expect(balanceImpactOfPayments(before)).toBe(0n);
    // Exactly one posted entry of -1200.00 after confirm — no double count.
    expect(balanceImpactOfPayments(afterConfirm)).toBe(-120000n);
  });

  it("a rejected self-report (voided, never posted) stays 0", () => {
    expect(balanceImpactOfPayments([{ status: "voided", amountCents: 50000n }])).toBe(0n);
  });

  it("only posted payments count in a mixed set", () => {
    const payments: ReportedPaymentLike[] = [
      { status: "posted", amountCents: 100000n }, // counts
      { status: "pending", amountCents: 25000n }, // self-report, ignored
      { status: "voided", amountCents: 30000n }, // offset by reversal, ignored
      { status: "posted", amountCents: 5000n }, // counts
    ];
    expect(balanceImpactOfPayments(payments)).toBe(-105000n);
  });
});
