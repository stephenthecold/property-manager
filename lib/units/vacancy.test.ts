import { describe, expect, it } from "vitest";
import { computeVacancy, compareVacancy, type VacancyInput } from "./vacancy";

const now = new Date("2026-06-15T00:00:00Z");
const future = new Date("2026-08-01T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");

function v(partial: Partial<VacancyInput>): VacancyInput {
  return {
    occupancyStatus: "occupied",
    availableFromDate: null,
    activeLeaseEndDate: null,
    ...partial,
  };
}

describe("computeVacancy", () => {
  it("vacant unit with no override is available now", () => {
    const r = computeVacancy(v({ occupancyStatus: "vacant" }), now);
    expect(r).toMatchObject({ state: "vacant", availableNow: true, availableOn: null, listed: true });
  });

  it("occupied lease ending in the future is an upcoming vacancy (source: lease)", () => {
    const r = computeVacancy(v({ activeLeaseEndDate: future }), now);
    expect(r).toMatchObject({ state: "upcoming", availableNow: false, availableOn: future, source: "lease", listed: true });
  });

  it("occupied with no end date is occupied (not listed)", () => {
    const r = computeVacancy(v({}), now);
    expect(r).toMatchObject({ state: "occupied", listed: false, availableOn: null });
  });

  it("occupied with a past lease end is occupied (not listed)", () => {
    const r = computeVacancy(v({ activeLeaseEndDate: past }), now);
    expect(r.listed).toBe(false);
  });

  it("manual override wins over the lease end date", () => {
    const earlier = new Date("2026-07-01T00:00:00Z");
    const r = computeVacancy(v({ availableFromDate: earlier, activeLeaseEndDate: future }), now);
    expect(r).toMatchObject({ state: "upcoming", availableOn: earlier, source: "manual" });
  });

  it("maintenance unit with a future override is upcoming (e.g. back in service then)", () => {
    const r = computeVacancy(v({ occupancyStatus: "maintenance", availableFromDate: future }), now);
    expect(r).toMatchObject({ state: "upcoming", availableOn: future, source: "manual", listed: true });
  });

  it("maintenance/unavailable with no override counts as available now", () => {
    for (const s of ["maintenance", "unavailable"] as const) {
      expect(computeVacancy(v({ occupancyStatus: s }), now)).toMatchObject({
        state: "vacant",
        availableNow: true,
        listed: true,
      });
    }
  });

  it("a stale (past) manual override on an occupied unit does not list it", () => {
    const r = computeVacancy(v({ availableFromDate: past }), now);
    expect(r.listed).toBe(false);
  });
});

describe("compareVacancy", () => {
  it("orders available-now before dated, then by soonest date", () => {
    const nowRow = { availableNow: true, availableOn: null };
    const soon = { availableNow: false, availableOn: new Date("2026-07-01T00:00:00Z") };
    const later = { availableNow: false, availableOn: future };
    const sorted = [later, nowRow, soon].sort(compareVacancy);
    expect(sorted).toEqual([nowRow, soon, later]);
  });
});
