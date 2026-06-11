import { describe, it, expect } from "vitest";
import {
  expectedMonthlyChargeCents,
  prorationForStart,
  rentForPeriod,
  shouldApplyScheduledRent,
} from "@/lib/accounting/rent";
import { computeLateFeeCents } from "@/lib/accounting/fees";
import {
  listExpectedPeriods,
  parseDateOnlyInZone,
} from "@/lib/accounting/periods";

const TZ = "America/New_York";

/** Midnight in the property tz, the way action code mints date-only values. */
function tzDate(iso: string): Date {
  return new Date(`${iso}T00:00:00-04:00`); // EDT; tests use summer dates
}

describe("rentForPeriod / internet add-on", () => {
  it("charges plain rent when internet is disabled", () => {
    const r = rentForPeriod(
      { rentAmountCents: 120000n, internetEnabled: false, internetFeeCents: 2500n },
      "2026-07-01",
      TZ,
    );
    expect(r.totalCents).toBe(120000n);
    expect(r.internetFeeCents).toBe(0n);
  });

  it("adds the unit's internet fee when enabled", () => {
    const r = rentForPeriod(
      { rentAmountCents: 120000n, internetEnabled: true, internetFeeCents: 2500n },
      "2026-07-01",
      TZ,
    );
    expect(r.baseRentCents).toBe(120000n);
    expect(r.internetFeeCents).toBe(2500n);
    expect(r.totalCents).toBe(122500n);
  });

  it("respects a custom fee and treats a missing fee as zero", () => {
    expect(
      rentForPeriod(
        { rentAmountCents: 120000n, internetEnabled: true, internetFeeCents: 4000n },
        "2026-07-01",
        TZ,
      ).totalCents,
    ).toBe(124000n);
    expect(
      rentForPeriod(
        { rentAmountCents: 120000n, internetEnabled: true, internetFeeCents: null },
        "2026-07-01",
        TZ,
      ).totalCents,
    ).toBe(120000n);
  });
});

describe("rentForPeriod / scheduled increase", () => {
  const terms = {
    rentAmountCents: 120000n,
    scheduledRentAmountCents: 130000n,
    scheduledRentEffectiveDate: tzDate("2026-07-01"),
  };

  it("uses the old rent for periods due before the effective date", () => {
    const r = rentForPeriod(terms, "2026-06-01", TZ);
    expect(r.baseRentCents).toBe(120000n);
    expect(r.scheduledApplied).toBe(false);
  });

  it("uses the new rent from the effective date onward", () => {
    expect(rentForPeriod(terms, "2026-07-01", TZ).baseRentCents).toBe(130000n);
    expect(rentForPeriod(terms, "2026-08-01", TZ).baseRentCents).toBe(130000n);
    expect(rentForPeriod(terms, "2026-07-01", TZ).scheduledApplied).toBe(true);
  });

  it("ignores a half-configured schedule (amount or date missing)", () => {
    expect(
      rentForPeriod(
        { rentAmountCents: 120000n, scheduledRentAmountCents: 130000n },
        "2026-08-01",
        TZ,
      ).baseRentCents,
    ).toBe(120000n);
    expect(
      rentForPeriod(
        {
          rentAmountCents: 120000n,
          scheduledRentEffectiveDate: tzDate("2026-07-01"),
        },
        "2026-08-01",
        TZ,
      ).baseRentCents,
    ).toBe(120000n);
  });

  it("evaluates the effective date in the property tz, not UTC", () => {
    // 2026-07-01T02:00Z is still 2026-06-30 in New York, so the increase
    // takes effect with the June 30 period, not July 1.
    const r = rentForPeriod(
      {
        rentAmountCents: 120000n,
        scheduledRentAmountCents: 130000n,
        scheduledRentEffectiveDate: new Date("2026-07-01T02:00:00Z"),
      },
      "2026-06-30",
      TZ,
    );
    expect(r.baseRentCents).toBe(130000n);
  });

  it("combines a scheduled increase with the internet add-on", () => {
    const r = rentForPeriod(
      { ...terms, internetEnabled: true, internetFeeCents: 2500n },
      "2026-07-01",
      TZ,
    );
    expect(r.totalCents).toBe(132500n);
  });
});

describe("prorationForStart (mid-month move-in, billed on the 1st)", () => {
  it("prorates the move-in month by days occupied", () => {
    // June 15 start, rent $1,200, 30-day June: 16/30 days = $640.00,
    // keyed to the otherwise-never-billed June period.
    const p = prorationForStart({
      startDate: parseDateOnlyInZone("2026-06-15", TZ)!,
      dueDay: 1,
      tz: TZ,
      terms: { rentAmountCents: 120000n },
    });
    expect(p).toEqual({
      periodKey: "2026-06-01",
      amountCents: 64000n,
      daysCharged: 16,
      daysInMonth: 30,
    });
  });

  it("returns null when the lease starts exactly on a due date", () => {
    expect(
      prorationForStart({
        startDate: parseDateOnlyInZone("2026-06-01", TZ)!,
        dueDay: 1,
        tz: TZ,
        terms: { rentAmountCents: 120000n },
      }),
    ).toBeNull();
  });

  it("prorates the full monthly charge including the internet add-on", () => {
    const p = prorationForStart({
      startDate: parseDateOnlyInZone("2026-06-15", TZ)!,
      dueDay: 1,
      tz: TZ,
      terms: { rentAmountCents: 120000n, internetEnabled: true, internetFeeCents: 2500n },
    });
    // 122500 * 16/30 = 65333.33 -> half-up 65333
    expect(p?.amountCents).toBe(65333n);
  });

  it("rounds half-up on a single day in a 31-day month", () => {
    const p = prorationForStart({
      startDate: parseDateOnlyInZone("2026-07-31", TZ)!,
      dueDay: 1,
      tz: TZ,
      terms: { rentAmountCents: 100000n },
    });
    // 100000/31 = 3225.8 -> 3226
    expect(p?.daysCharged).toBe(1);
    expect(p?.amountCents).toBe(3226n);
  });

  it("clamps the span to a lease that ends before its first full period", () => {
    // Feb 10 -> Feb 20 lease, dueDay 1: bills exactly the 11 occupied days.
    const p = prorationForStart({
      startDate: parseDateOnlyInZone("2026-02-10", TZ)!,
      endDate: parseDateOnlyInZone("2026-02-20", TZ)!,
      dueDay: 1,
      tz: TZ,
      terms: { rentAmountCents: 120000n },
    });
    expect(p?.daysCharged).toBe(11);
    expect(p?.amountCents).toBe(47143n); // 120000 * 11/28 half-up
  });

  it("handles non-1 due days (span anchored to the prior period)", () => {
    const p = prorationForStart({
      startDate: parseDateOnlyInZone("2026-06-10", TZ)!,
      dueDay: 15,
      tz: TZ,
      terms: { rentAmountCents: 120000n },
    });
    // June 10-14 = 5 days before the first full period (due June 15).
    expect(p?.periodKey).toBe("2026-05-15");
    expect(p?.daysCharged).toBe(5);
    expect(p?.amountCents).toBe(20000n); // 120000 * 5/30
  });
});

describe("shouldApplyScheduledRent", () => {
  const terms = {
    scheduledRentAmountCents: 130000n,
    scheduledRentEffectiveDate: tzDate("2026-07-01"),
  };

  it("is false before the effective date and true from midnight property-tz on", () => {
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-06-30T23:59:00-04:00"), TZ),
    ).toBe(false);
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-07-01T00:00:00-04:00"), TZ),
    ).toBe(true);
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-07-15T12:00:00-04:00"), TZ),
    ).toBe(true);
  });

  it("is false when no increase is scheduled", () => {
    expect(
      shouldApplyScheduledRent(
        { scheduledRentAmountCents: null, scheduledRentEffectiveDate: null },
        new Date("2026-07-15T12:00:00-04:00"),
        TZ,
      ),
    ).toBe(false);
  });

  it("agrees with rentForPeriod about the civil day of a UTC-minted instant", () => {
    // 2026-07-01T02:00Z is civil June 30 in New York — both the pricing
    // (effectiveKey) and the rollover predicate must treat it as June 30.
    const terms = {
      scheduledRentAmountCents: 130000n,
      scheduledRentEffectiveDate: new Date("2026-07-01T02:00:00Z"),
    };
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-06-30T12:00:00-04:00"), TZ),
    ).toBe(true);
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-06-29T12:00:00-04:00"), TZ),
    ).toBe(false);
  });

  it("handles winter (EST) dates minted the way the actions mint them", () => {
    const effective = parseDateOnlyInZone("2026-12-01", TZ)!;
    const terms = {
      rentAmountCents: 120000n,
      scheduledRentAmountCents: 130000n,
      scheduledRentEffectiveDate: effective,
    };
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-11-30T23:00:00-05:00"), TZ),
    ).toBe(false);
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-12-01T00:30:00-05:00"), TZ),
    ).toBe(true);
    expect(rentForPeriod(terms, "2026-12-01", TZ).baseRentCents).toBe(130000n);
    expect(rentForPeriod(terms, "2026-11-01", TZ).baseRentCents).toBe(120000n);
  });
});

describe("billing composition (real period keys, late fees, expected charge)", () => {
  it("back-fill across a mid-month effective date: pre-effective periods keep old pricing", () => {
    // Worker down May–Sep; one catch-up run back-fills everything with the
    // schedule still pending. Periods due before Jul 15 must price old rent.
    const terms = {
      rentAmountCents: 120000n,
      scheduledRentAmountCents: 130000n,
      scheduledRentEffectiveDate: parseDateOnlyInZone("2026-07-15", TZ)!,
      internetEnabled: true,
      internetFeeCents: 2500n,
    };
    const periods = listExpectedPeriods({
      startDate: parseDateOnlyInZone("2026-05-01", TZ)!,
      endDate: null,
      dueDay: 1,
      tz: TZ,
      now: new Date("2026-09-15T12:00:00-04:00"),
    });
    const totals = Object.fromEntries(
      periods.map((p) => [p.periodKey, rentForPeriod(terms, p.periodKey, TZ).totalCents]),
    );
    expect(totals).toEqual({
      "2026-05-01": 122500n,
      "2026-06-01": 122500n,
      "2026-07-01": 122500n, // due before Jul 15 — old rent
      "2026-08-01": 132500n,
      "2026-09-01": 132500n,
    });
    // The rollover predicate fires on this same catch-up run...
    expect(
      shouldApplyScheduledRent(terms, new Date("2026-09-15T12:00:00-04:00"), TZ),
    ).toBe(true);
    // ...and pricing under the rolled-forward terms matches the schedule.
    const rolled = { ...terms, rentAmountCents: 130000n, scheduledRentAmountCents: null, scheduledRentEffectiveDate: null };
    expect(rentForPeriod(rolled, "2026-10-01", TZ).totalCents).toBe(132500n);
  });

  it("percentage late fee is computed on the full charge, internet included (pinned decision)", () => {
    const rent = rentForPeriod(
      { rentAmountCents: 120000n, internetEnabled: true, internetFeeCents: 2500n },
      "2026-07-01",
      TZ,
    );
    expect(
      computeLateFeeCents({
        type: "percentage",
        rentChargeCents: rent.totalCents,
        fixedAmountCents: null,
        bps: 500,
      }),
    ).toBe(6125n); // 5% of 1225.00, not of 1200.00
  });

  it("expectedMonthlyChargeCents matches what billing charges", () => {
    expect(
      expectedMonthlyChargeCents({
        rentAmountCents: 120000n,
        internetEnabled: true,
        internetFeeCents: 2500n,
      }),
    ).toBe(122500n);
    expect(
      expectedMonthlyChargeCents({
        rentAmountCents: 120000n,
        internetEnabled: false,
        internetFeeCents: 2500n,
      }),
    ).toBe(120000n);
  });
});
