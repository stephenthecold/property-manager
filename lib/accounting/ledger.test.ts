import { describe, it, expect } from "vitest";
import {
  daysSinceLastPayment,
  type LedgerEntryInput,
  lastPaymentDate,
  netBalanceCents,
  paidForPeriodCents,
  tenantCreditCents,
  totalOwedCents,
} from "@/lib/accounting/ledger";

function entry(
  partial: Partial<LedgerEntryInput> & {
    entryType: LedgerEntryInput["entryType"];
    amountCents: bigint;
  },
): LedgerEntryInput {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    effectiveDate: partial.effectiveDate ?? new Date("2026-01-01T00:00:00Z"),
    periodKey: partial.periodKey ?? null,
    ...partial,
  };
}

describe("netBalance / owed / credit", () => {
  it("sums all entries with sign convention", () => {
    const entries = [
      entry({ entryType: "rent_charge", amountCents: 120000n }),
      entry({ entryType: "payment", amountCents: -50000n }),
    ];
    expect(netBalanceCents(entries)).toBe(70000n);
    expect(totalOwedCents(entries)).toBe(70000n);
    expect(tenantCreditCents(entries)).toBe(0n);
  });

  it("overpayment yields credit (negative balance)", () => {
    const entries = [
      entry({ entryType: "rent_charge", amountCents: 120000n }),
      entry({ entryType: "payment", amountCents: -150000n }),
    ];
    expect(netBalanceCents(entries)).toBe(-30000n);
    expect(totalOwedCents(entries)).toBe(0n);
    expect(tenantCreditCents(entries)).toBe(30000n);
  });
});

describe("immutable ledger: void moves balance by exactly the amount, not twice", () => {
  it("a reversal offsets a charge once", () => {
    const charge = entry({
      id: "c1",
      entryType: "rent_charge",
      amountCents: 120000n,
    });
    expect(netBalanceCents([charge])).toBe(120000n);

    // Correction is an offsetting reversal; the original row is RETAINED.
    const reversal = entry({
      id: "r1",
      entryType: "reversal",
      amountCents: -120000n,
    });
    const after = [charge, reversal];
    expect(after).toHaveLength(2); // original not deleted
    expect(netBalanceCents(after)).toBe(0n); // moved by 120000, not 240000
  });
});

describe("edited-payment-three-times stays reconstructable", () => {
  it("net is always the sum of physical rows", () => {
    const entries = [
      entry({ id: "ch", entryType: "rent_charge", amountCents: 120000n }),
      entry({ id: "p1", entryType: "payment", amountCents: -120000n }),
      // 'edit 1': reverse the payment
      entry({ id: "rv1", entryType: "reversal", amountCents: 120000n }),
      // 'edit 2': re-record at a corrected amount
      entry({ id: "p2", entryType: "payment", amountCents: -100000n }),
      // 'edit 3': adjustment for a $5 discount
      entry({ id: "adj", entryType: "adjustment", amountCents: -500n }),
    ];
    expect(netBalanceCents(entries)).toBe(120000n - 100000n - 500n);
    expect(netBalanceCents(entries)).toBe(19500n);
  });
});

describe("last payment / days since", () => {
  it("finds the most recent payment", () => {
    const entries = [
      entry({
        entryType: "payment",
        amountCents: -10000n,
        effectiveDate: new Date("2026-01-05T00:00:00Z"),
      }),
      entry({
        entryType: "payment",
        amountCents: -20000n,
        effectiveDate: new Date("2026-02-05T00:00:00Z"),
      }),
      entry({
        entryType: "rent_charge",
        amountCents: 120000n,
        effectiveDate: new Date("2026-03-01T00:00:00Z"),
      }),
    ];
    expect(lastPaymentDate(entries)).toEqual(
      new Date("2026-02-05T00:00:00Z"),
    );
    expect(
      daysSinceLastPayment(entries, new Date("2026-02-15T00:00:00Z")),
    ).toBe(10);
  });
  it("returns null with no payments", () => {
    const entries = [entry({ entryType: "rent_charge", amountCents: 120000n })];
    expect(lastPaymentDate(entries)).toBeNull();
    expect(daysSinceLastPayment(entries, new Date())).toBeNull();
  });
});

describe("paidForPeriod (hint)", () => {
  it("sums payments tagged to a period as a positive number", () => {
    const entries = [
      entry({ entryType: "payment", amountCents: -50000n, periodKey: "2026-06-01" }),
      entry({ entryType: "payment", amountCents: -30000n, periodKey: "2026-06-01" }),
      entry({ entryType: "payment", amountCents: -10000n, periodKey: "2026-07-01" }),
    ];
    expect(paidForPeriodCents(entries, "2026-06-01")).toBe(80000n);
  });
});

describe("credit does not cross leases", () => {
  it("each lease balance is computed only from its own entries", () => {
    const leaseA = [
      entry({ entryType: "rent_charge", amountCents: 120000n }),
      entry({ entryType: "payment", amountCents: -150000n }), // $300 overpay -> credit
    ];
    const leaseB = [entry({ entryType: "rent_charge", amountCents: 120000n })];
    expect(tenantCreditCents(leaseA)).toBe(30000n);
    expect(totalOwedCents(leaseB)).toBe(120000n); // A's credit must not reduce B
  });
});
