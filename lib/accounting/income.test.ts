import { describe, it, expect } from "vitest";
import {
  groupIncomeByMonth,
  incomeMonthKey,
  type IncomeEntry,
} from "@/lib/accounting/income";

const NY = "America/New_York";
const SYDNEY = "Australia/Sydney";

function entry(overrides: Partial<IncomeEntry>): IncomeEntry {
  return {
    effectiveDate: new Date("2026-01-15T12:00:00-05:00"),
    tz: NY,
    entryType: "payment",
    amountCents: -100_000n,
    reversesPayment: false,
    property: "Maple Court",
    ...overrides,
  };
}

describe("incomeMonthKey / tz month bucketing", () => {
  it("buckets a late-UTC last-day entry into the NEXT month in an ahead-of-UTC tz", () => {
    // 2026-01-31T20:00Z is already 2026-02-01 07:00 in Sydney.
    expect(incomeMonthKey(new Date("2026-01-31T20:00:00Z"), SYDNEY)).toBe(
      "2026-02",
    );
    expect(incomeMonthKey(new Date("2026-01-31T20:00:00Z"), NY)).toBe(
      "2026-01",
    );
  });

  it("buckets an early-UTC first-day entry into the PREVIOUS month in a behind-UTC tz", () => {
    // 2026-02-01T02:00Z is still 2026-01-31 21:00 in New York.
    expect(incomeMonthKey(new Date("2026-02-01T02:00:00Z"), NY)).toBe(
      "2026-01",
    );
    expect(incomeMonthKey(new Date("2026-02-01T02:00:00Z"), SYDNEY)).toBe(
      "2026-02",
    );
  });
});

describe("groupIncomeByMonth", () => {
  it("sums payments as positive cash with a payment count", () => {
    const groups = groupIncomeByMonth([
      entry({ amountCents: -100_000n }),
      entry({ amountCents: -25_050n }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].month).toBe("2026-01");
    expect(groups[0].property).toBe("Maple Court");
    expect(groups[0].cashReceivedCents).toBe(125_050n);
    expect(groups[0].paymentCount).toBe(2);
    expect(groups[0].chargesBilledCents).toBe(0n);
    expect(groups[0].lateFeesBilledCents).toBe(0n);
  });

  it("nets a same-month payment reversal to zero cash (count still counts the payment)", () => {
    const groups = groupIncomeByMonth([
      entry({ amountCents: -100_000n }),
      entry({
        entryType: "reversal",
        amountCents: 100_000n,
        reversesPayment: true,
        effectiveDate: new Date("2026-01-20T12:00:00-05:00"),
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cashReceivedCents).toBe(0n);
    expect(groups[0].paymentCount).toBe(1);
  });

  it("shows a cross-month reversal as negative cash in the reversal's month", () => {
    const groups = groupIncomeByMonth([
      entry({ amountCents: -100_000n }),
      entry({
        entryType: "reversal",
        amountCents: 100_000n,
        reversesPayment: true,
        effectiveDate: new Date("2026-02-03T12:00:00-05:00"),
      }),
    ]);
    expect(groups.map((g) => g.month)).toEqual(["2026-01", "2026-02"]);
    expect(groups[0].cashReceivedCents).toBe(100_000n);
    expect(groups[1].cashReceivedCents).toBe(-100_000n);
    expect(groups[1].paymentCount).toBe(0);
  });

  it("ignores reversals of non-payments and other entry types", () => {
    const groups = groupIncomeByMonth([
      entry({
        entryType: "reversal",
        amountCents: -100_000n,
        reversesPayment: false,
      }),
      entry({ entryType: "adjustment", amountCents: 5_000n }),
      entry({ entryType: "credit", amountCents: -5_000n }),
    ]);
    expect(groups).toEqual([]);
  });

  it("accrues rent_charge and late_fee into their own columns", () => {
    const groups = groupIncomeByMonth([
      entry({ entryType: "rent_charge", amountCents: 150_000n }),
      entry({ entryType: "rent_charge", amountCents: 150_000n }),
      entry({ entryType: "late_fee", amountCents: 7_500n }),
      entry({ amountCents: -150_000n }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].chargesBilledCents).toBe(300_000n);
    expect(groups[0].lateFeesBilledCents).toBe(7_500n);
    expect(groups[0].cashReceivedCents).toBe(150_000n);
  });

  it("uses each entry's own property tz for bucketing", () => {
    // Same instant: Feb in Sydney, Jan in New York.
    const instant = new Date("2026-01-31T20:00:00Z");
    const groups = groupIncomeByMonth([
      entry({
        effectiveDate: instant,
        tz: SYDNEY,
        property: "Harbour View",
        amountCents: -10_000n,
      }),
      entry({ effectiveDate: instant, tz: NY, amountCents: -20_000n }),
    ]);
    expect(groups.map((g) => [g.month, g.property])).toEqual([
      ["2026-01", "Maple Court"],
      ["2026-02", "Harbour View"],
    ]);
  });

  it("groups per property within a month and sorts months ascending then property", () => {
    const groups = groupIncomeByMonth([
      entry({
        property: "Zelkova Row",
        effectiveDate: new Date("2026-02-10T09:00:00-05:00"),
        amountCents: -1n,
      }),
      entry({
        property: "Aspen Flats",
        effectiveDate: new Date("2026-02-11T09:00:00-05:00"),
        amountCents: -2n,
      }),
      entry({
        property: "Aspen Flats",
        effectiveDate: new Date("2026-01-05T09:00:00-05:00"),
        amountCents: -3n,
      }),
    ]);
    expect(groups.map((g) => [g.month, g.property])).toEqual([
      ["2026-01", "Aspen Flats"],
      ["2026-02", "Aspen Flats"],
      ["2026-02", "Zelkova Row"],
    ]);
  });

  it("accumulates in bigint beyond Number's safe-integer range", () => {
    const huge = -9_007_199_254_740_993n; // |x| = 2^53 + 1, not representable as a float
    const groups = groupIncomeByMonth([
      entry({ amountCents: huge }),
      entry({ amountCents: huge }),
    ]);
    expect(groups[0].cashReceivedCents).toBe(18_014_398_509_481_986n);
  });
});
