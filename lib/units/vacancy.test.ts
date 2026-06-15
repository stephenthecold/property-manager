import { describe, expect, it } from "vitest";
import { computeVacancy, compareVacancy, type VacancyInput } from "./vacancy";

const now = new Date("2026-06-15T00:00:00Z");
const future = new Date("2026-08-01T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");

function v(partial: Partial<VacancyInput>): VacancyInput {
  return {
    serviceStatus: "in_service",
    availableFromDate: null,
    activeLeaseEndDate: null,
    hasActiveLease: false,
    ...partial,
  };
}

describe("computeVacancy", () => {
  it("in service, no lease → available now (vacant)", () => {
    expect(computeVacancy(v({}), now)).toMatchObject({
      state: "vacant",
      availableNow: true,
      listed: true,
    });
  });

  it("in service, active lease, no end → occupied (not listed)", () => {
    expect(computeVacancy(v({ hasActiveLease: true }), now)).toMatchObject({
      state: "occupied",
      availableNow: false,
      listed: false,
    });
  });

  it("active lease ending in the future → upcoming (source: lease)", () => {
    expect(
      computeVacancy(v({ hasActiveLease: true, activeLeaseEndDate: future }), now),
    ).toMatchObject({ state: "upcoming", availableOn: future, source: "lease", listed: true });
  });

  it("active lease ended in the PAST → occupied (stale end ignored)", () => {
    expect(
      computeVacancy(v({ hasActiveLease: true, activeLeaseEndDate: past }), now),
    ).toMatchObject({ state: "occupied", listed: false });
  });

  it("occupancy WINS: active lease + maintenance → occupied, NOT listed", () => {
    expect(
      computeVacancy(v({ hasActiveLease: true, serviceStatus: "maintenance" }), now),
    ).toMatchObject({ state: "occupied", availableNow: false, listed: false });
  });

  it("occupancy WINS: active lease + unavailable → occupied, NOT listed", () => {
    expect(
      computeVacancy(v({ hasActiveLease: true, serviceStatus: "unavailable" }), now),
    ).toMatchObject({ state: "occupied", listed: false });
  });

  it("active lease ending + maintenance → upcoming (occupancy still wins the listing)", () => {
    expect(
      computeVacancy(
        v({ hasActiveLease: true, serviceStatus: "maintenance", activeLeaseEndDate: future }),
        now,
      ),
    ).toMatchObject({ state: "upcoming", availableOn: future, source: "lease" });
  });

  it("unavailable → 'unavailable', NEVER available now, NOT listed", () => {
    expect(computeVacancy(v({ serviceStatus: "unavailable" }), now)).toMatchObject({
      state: "unavailable",
      availableNow: false,
      listed: false,
    });
  });

  it("maintenance → 'maintenance', not available now, but LISTED (trackable)", () => {
    expect(computeVacancy(v({ serviceStatus: "maintenance" }), now)).toMatchObject({
      state: "maintenance",
      availableNow: false,
      listed: true,
    });
  });

  it("maintenance with a future ready date → maintenance + that date", () => {
    expect(
      computeVacancy(v({ serviceStatus: "maintenance", availableFromDate: future }), now),
    ).toMatchObject({ state: "maintenance", availableOn: future, source: "manual", listed: true });
  });

  it("manual override wins over the lease end date", () => {
    const earlier = new Date("2026-07-01T00:00:00Z");
    expect(
      computeVacancy(
        v({ hasActiveLease: true, availableFromDate: earlier, activeLeaseEndDate: future }),
        now,
      ),
    ).toMatchObject({ state: "upcoming", availableOn: earlier, source: "manual" });
  });

  it("in service, no lease, future manual date → upcoming", () => {
    expect(computeVacancy(v({ availableFromDate: future }), now)).toMatchObject({
      state: "upcoming",
      availableOn: future,
      source: "manual",
    });
  });

  it("a stale (past) manual date does not create a future hold", () => {
    expect(computeVacancy(v({ availableFromDate: past }), now)).toMatchObject({
      state: "vacant",
      availableNow: true,
    });
  });
});

describe("compareVacancy", () => {
  it("orders available-now before dated, then by soonest date", () => {
    const nowRow = { availableNow: true, availableOn: null };
    const soon = { availableNow: false, availableOn: new Date("2026-07-01T00:00:00Z") };
    const later = { availableNow: false, availableOn: future };
    expect([later, nowRow, soon].sort(compareVacancy)).toEqual([nowRow, soon, later]);
  });
});
