import { describe, it, expect } from "vitest";
import {
  collectedWindows,
  compareCollected,
  computeOccupancy,
  computeTurnoverCost,
  computeVacancyLoss,
  dailyRentCents,
  daysVacant,
  periodDelta,
  type VacantUnitInput,
} from "@/lib/accounting/kpis";

const TZ = "America/New_York";
// A date is interpreted in the property tz; use noon to avoid DST/midnight edges.
const at = (iso: string) => new Date(`${iso}T12:00:00-05:00`);

describe("computeOccupancy", () => {
  it("occupied / rentable, off-market excluded from the denominator", () => {
    // 10 units, 1 off-market → 9 rentable, 7 occupied → 7/9.
    const o = computeOccupancy({ occupiedUnits: 7, totalUnits: 10, unavailableUnits: 1 });
    expect(o.rentableUnits).toBe(9);
    expect(o.occupiedUnits).toBe(7);
    expect(o.vacantUnits).toBe(2);
    expect(o.rate).toBeCloseTo(7 / 9, 10);
  });

  it("fully occupied → rate 1", () => {
    const o = computeOccupancy({ occupiedUnits: 5, totalUnits: 5, unavailableUnits: 0 });
    expect(o.rate).toBe(1);
    expect(o.vacantUnits).toBe(0);
  });

  it("zero rentable units → rate 0 (no divide-by-zero)", () => {
    const o = computeOccupancy({ occupiedUnits: 0, totalUnits: 3, unavailableUnits: 3 });
    expect(o.rentableUnits).toBe(0);
    expect(o.rate).toBe(0);
    expect(o.vacantUnits).toBe(0);
  });

  it("no units at all → rate 0", () => {
    const o = computeOccupancy({ occupiedUnits: 0, totalUnits: 0, unavailableUnits: 0 });
    expect(o.rate).toBe(0);
    expect(o.rentableUnits).toBe(0);
  });

  it("clamps occupied above rentable (data anomaly) to never exceed 100%", () => {
    const o = computeOccupancy({ occupiedUnits: 12, totalUnits: 10, unavailableUnits: 2 });
    expect(o.rentableUnits).toBe(8);
    expect(o.occupiedUnits).toBe(8);
    expect(o.rate).toBe(1);
    expect(o.vacantUnits).toBe(0);
  });
});

describe("dailyRentCents", () => {
  it("monthly / 30, truncating", () => {
    expect(dailyRentCents(150000n)).toBe(5000n); // $1500/mo → $50/day
    expect(dailyRentCents(100000n)).toBe(3333n); // $1000/mo → 33.33
  });
  it("negative monthly clamps to 0", () => {
    expect(dailyRentCents(-100n)).toBe(0n);
  });
  it("zero → zero", () => {
    expect(dailyRentCents(0n)).toBe(0n);
  });
});

describe("daysVacant", () => {
  it("counts whole civil days in the property tz", () => {
    expect(daysVacant(at("2026-06-01"), at("2026-06-28"), TZ)).toBe(27);
  });
  it("same day → 0", () => {
    expect(daysVacant(at("2026-06-28"), at("2026-06-28"), TZ)).toBe(0);
  });
  it("future start → 0, never negative", () => {
    expect(daysVacant(at("2026-07-10"), at("2026-06-28"), TZ)).toBe(0);
  });
});

describe("computeVacancyLoss", () => {
  const u = (vacantSince: Date | null, rentCents: bigint): VacantUnitInput => ({
    tz: TZ,
    vacantSince,
    marketRentCents: rentCents,
  });

  it("days × daily rent per unit, summed", () => {
    // unit A: vacant 27 days @ $1500/mo ($50/day) = $1350.00
    // unit B: vacant 10 days @ $900/mo ($30/day)  = $300.00
    const r = computeVacancyLoss(
      [u(at("2026-06-01"), 150000n), u(at("2026-06-18"), 90000n)],
      at("2026-06-28"),
    );
    expect(r.vacantUnits).toBe(2);
    expect(r.perUnit[0]).toEqual({ daysVacant: 27, lostRentCents: 135000n });
    expect(r.perUnit[1]).toEqual({ daysVacant: 10, lostRentCents: 30000n });
    expect(r.totalDaysVacant).toBe(37);
    expect(r.totalLostRentCents).toBe(165000n);
  });

  it("caps days at the lookback window", () => {
    // vacant since long ago, cap 30 days @ $3000/mo ($100/day) = $3000.00
    const r = computeVacancyLoss([u(at("2024-01-01"), 300000n)], at("2026-06-28"), 30);
    expect(r.perUnit[0].daysVacant).toBe(30);
    expect(r.perUnit[0].lostRentCents).toBe(300000n);
  });

  it("unknown vacancy start (never leased, null) uses the cap", () => {
    const r = computeVacancyLoss([u(null, 90000n)], at("2026-06-28"), 45);
    expect(r.perUnit[0].daysVacant).toBe(45);
    expect(r.perUnit[0].lostRentCents).toBe(135000n); // 45 × $30
  });

  it("empty → zeros", () => {
    const r = computeVacancyLoss([], at("2026-06-28"));
    expect(r).toEqual({
      vacantUnits: 0,
      totalDaysVacant: 0,
      totalLostRentCents: 0n,
      perUnit: [],
    });
  });
});

describe("computeTurnoverCost", () => {
  it("sums damages + turnover expenses", () => {
    const r = computeTurnoverCost({ moveOutDamagesCents: 45000n, turnoverExpensesCents: 30000n });
    expect(r.totalCents).toBe(75000n);
    expect(r.moveOutDamagesCents).toBe(45000n);
    expect(r.turnoverExpensesCents).toBe(30000n);
  });
  it("clamps negative streams to 0", () => {
    const r = computeTurnoverCost({ moveOutDamagesCents: -1n, turnoverExpensesCents: -1n });
    expect(r.totalCents).toBe(0n);
  });
  it("zero both → zero", () => {
    expect(computeTurnoverCost({ moveOutDamagesCents: 0n, turnoverExpensesCents: 0n }).totalCents).toBe(0n);
  });
});

describe("periodDelta", () => {
  it("absolute + percentage delta", () => {
    const d = periodDelta(110000n, 100000n);
    expect(d.deltaCents).toBe(10000n);
    expect(d.deltaPct).toBeCloseTo(0.1, 10);
  });
  it("decline → negative delta and pct", () => {
    const d = periodDelta(80000n, 100000n);
    expect(d.deltaCents).toBe(-20000n);
    expect(d.deltaPct).toBeCloseTo(-0.2, 10);
  });
  it("prior zero → pct null (undefined base), delta still carries", () => {
    const d = periodDelta(50000n, 0n);
    expect(d.deltaCents).toBe(50000n);
    expect(d.deltaPct).toBeNull();
  });
  it("both zero → zero delta, null pct", () => {
    const d = periodDelta(0n, 0n);
    expect(d.deltaCents).toBe(0n);
    expect(d.deltaPct).toBeNull();
  });
});

describe("compareCollected", () => {
  it("MoM and YoY off the current month", () => {
    const c = compareCollected({
      currentMonthCents: 120000n,
      priorMonthCents: 100000n,
      sameMonthLastYearCents: 80000n,
    });
    expect(c.monthOverMonth.deltaCents).toBe(20000n);
    expect(c.monthOverMonth.deltaPct).toBeCloseTo(0.2, 10);
    expect(c.yearOverYear.deltaCents).toBe(40000n);
    expect(c.yearOverYear.deltaPct).toBeCloseTo(0.5, 10);
  });
});

describe("collectedWindows", () => {
  it("current / prior / same-month-last-year, month-aligned in tz", () => {
    const w = collectedWindows(at("2026-06-28"), TZ);
    expect(w.currentMonth.key).toBe("2026-06");
    expect(w.priorMonth.key).toBe("2026-05");
    expect(w.sameMonthLastYear.key).toBe("2025-06");
    // exclusive end is the start of the next month, and windows abut.
    expect(w.currentMonth.end.getTime()).toBeGreaterThan(w.currentMonth.start.getTime());
    expect(w.priorMonth.end.getTime()).toBe(w.currentMonth.start.getTime());
    expect(w.sameMonthLastYear.end.getTime()).toBeLessThan(w.priorMonth.start.getTime());
  });

  it("January anchor rolls year back for the prior month", () => {
    const w = collectedWindows(at("2026-01-15"), TZ);
    expect(w.currentMonth.key).toBe("2026-01");
    expect(w.priorMonth.key).toBe("2025-12");
    expect(w.sameMonthLastYear.key).toBe("2025-01");
  });
});
