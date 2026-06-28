import { describe, it, expect } from "vitest";
import {
  computeLateFeeCents,
  dailyLateFeeAccruals,
  dailyLateFeePeriodKey,
} from "@/lib/accounting/fees";

const TZ = "America/New_York";
const DUE = new Date("2026-06-01T00:00:00-04:00");

describe("computeLateFeeCents", () => {
  it("daily type returns 0 from the one-shot path", () => {
    expect(
      computeLateFeeCents({ type: "daily", rentChargeCents: 120000n, fixedAmountCents: 1000n }),
    ).toBe(0n);
  });
});

describe("dailyLateFeeAccruals ($10/day after 5 grace days)", () => {
  const base = { dueDate: DUE, graceDays: 5, tz: TZ, dailyRateCents: 1000n };

  it("accrues nothing inside the grace window", () => {
    expect(
      dailyLateFeeAccruals({ ...base, now: new Date("2026-06-06T12:00:00-04:00") }),
    ).toEqual([]);
  });

  it("accrues day 1 on the first day past grace", () => {
    const a = dailyLateFeeAccruals({ ...base, now: new Date("2026-06-07T08:00:00-04:00") });
    expect(a).toHaveLength(1);
    expect(a[0].day).toBe(1);
    expect(a[0].amountCents).toBe(1000n);
  });

  it("accrues one entry per day, catch-up safe", () => {
    const a = dailyLateFeeAccruals({ ...base, now: new Date("2026-06-10T12:00:00-04:00") });
    expect(a.map((x) => x.day)).toEqual([1, 2, 3, 4]);
    expect(a.reduce((s, x) => s + x.amountCents, 0n)).toBe(4000n);
  });

  it("caps the total per period, with a partial final day", () => {
    const a = dailyLateFeeAccruals({
      ...base,
      capCents: 3500n,
      now: new Date("2026-06-20T12:00:00-04:00"),
    });
    expect(a.map((x) => x.amountCents)).toEqual([1000n, 1000n, 1000n, 500n]);
    expect(a.reduce((s, x) => s + x.amountCents, 0n)).toBe(3500n);
  });

  it("evaluates 'a day late' in the property tz, not UTC", () => {
    // 2026-06-07T03:00Z is still June 6 (23:00) in New York -> not late yet.
    expect(
      dailyLateFeeAccruals({ ...base, now: new Date("2026-06-07T03:00:00Z") }),
    ).toEqual([]);
    expect(
      dailyLateFeeAccruals({ ...base, now: new Date("2026-06-07T05:00:00Z") }),
    ).toHaveLength(1);
  });

  it("zero/negative rate accrues nothing", () => {
    expect(
      dailyLateFeeAccruals({
        ...base,
        dailyRateCents: 0n,
        now: new Date("2026-06-20T12:00:00-04:00"),
      }),
    ).toEqual([]);
  });

  it("mints a distinct per-day period key", () => {
    expect(dailyLateFeePeriodKey("2026-06-01", 3)).toBe("2026-06-01+d3");
  });

  it("resumes after posted days and binds the cap to the POSTED total (rate lowered)", () => {
    // $30/day posted d1-d3 = $90 under the old rate; rate lowered to $10/day
    // with a $100 cap: only $10 of headroom remains — one more (partial) day.
    const a = dailyLateFeeAccruals({
      ...base,
      dailyRateCents: 1000n,
      capCents: 10000n,
      fromDay: 3,
      alreadyAccruedCents: 9000n,
      now: new Date("2026-06-30T12:00:00-04:00"),
    });
    expect(a.map((x) => [x.day, x.amountCents])).toEqual([[4, 1000n]]);
  });

  it("a raised cap resumes accrual from the posted state, not a replayed schedule", () => {
    // Old cap $70 posted d1=$30, d2=$30, d3=$10 (partial). Cap raised to $100:
    // accrual resumes at d4 with $30 of real headroom.
    const a = dailyLateFeeAccruals({
      ...base,
      dailyRateCents: 3000n,
      capCents: 10000n,
      fromDay: 3,
      alreadyAccruedCents: 7000n,
      now: new Date("2026-06-30T12:00:00-04:00"),
    });
    expect(a[0]).toMatchObject({ day: 4, amountCents: 3000n });
    expect(
      (7000n + a.reduce((s, x) => s + x.amountCents, 0n)) <= 10000n,
    ).toBe(true);
  });

  it("re-assessment at the same clock posts nothing already posted (no double-accrual)", () => {
    // First pass: 4 days late, all accrued and posted.
    const first = dailyLateFeeAccruals({ ...base, now: new Date("2026-06-10T12:00:00-04:00") });
    expect(first.map((x) => x.day)).toEqual([1, 2, 3, 4]);
    const postedThrough = first[first.length - 1].day;
    const postedSum = first.reduce((s, x) => s + x.amountCents, 0n);
    // Second pass at the SAME `now` with those days posted returns nothing. This
    // is the void-charge → recreate-same-period → re-assess path: each accrued
    // day's key is "<periodKey>+d<N>" (already posted), so the resume window is
    // empty and the partial unique index would block any duplicate regardless.
    const second = dailyLateFeeAccruals({
      ...base,
      fromDay: postedThrough,
      alreadyAccruedCents: postedSum,
      now: new Date("2026-06-10T12:00:00-04:00"),
    });
    expect(second).toEqual([]);
  });
});
