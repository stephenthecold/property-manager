/**
 * Pure unit-vacancy classification (DB-free, clock-injected) — unit-tested.
 *
 * A unit's availability for the dashboard "vacancy outlook" is one of:
 *   - vacant   → not currently occupied and available now
 *   - upcoming → will become available on a known future date (an occupied
 *                lease ending, or a manual availableFromDate, e.g. maintenance)
 *   - occupied → occupied with no known end date (not listed)
 *
 * The manual `availableFromDate` override always wins over the derived lease end
 * date. Only `vacant` and `upcoming` units are surfaced in the outlook list.
 */

export type OccupancyStatusLike =
  | "vacant"
  | "occupied"
  | "maintenance"
  | "unavailable";

export type VacancyState = "vacant" | "upcoming" | "occupied";

export interface VacancyInput {
  occupancyStatus: OccupancyStatusLike;
  /** Staff-set expected availability date (override); null when unset. */
  availableFromDate: Date | null;
  /** End date of the active lease, if any (null = open-ended / no lease). */
  activeLeaseEndDate: Date | null;
}

export interface Vacancy {
  state: VacancyState;
  /** True when the unit is available now (currently not occupied, no future override). */
  availableNow: boolean;
  /** The future date the unit becomes available; null when availableNow or occupied. */
  availableOn: Date | null;
  /** Where availableOn came from. */
  source: "now" | "lease" | "manual" | null;
  /** Convenience: should this unit appear in the vacancy outlook list? */
  listed: boolean;
}

const isFuture = (d: Date, now: Date): boolean => d.getTime() > now.getTime();

export function computeVacancy(input: VacancyInput, now: Date): Vacancy {
  const manual = input.availableFromDate;

  if (input.occupancyStatus !== "occupied") {
    // Not occupied. A future manual date (e.g. under maintenance until then)
    // makes it upcoming; otherwise it is available now.
    if (manual && isFuture(manual, now)) {
      return { state: "upcoming", availableNow: false, availableOn: manual, source: "manual", listed: true };
    }
    return { state: "vacant", availableNow: true, availableOn: null, source: "now", listed: true };
  }

  // Occupied: a known future availability date (manual override, else lease end)
  // makes it an upcoming vacancy; without one it is occupied indefinitely.
  if (manual && isFuture(manual, now)) {
    return { state: "upcoming", availableNow: false, availableOn: manual, source: "manual", listed: true };
  }
  if (input.activeLeaseEndDate && isFuture(input.activeLeaseEndDate, now)) {
    return {
      state: "upcoming",
      availableNow: false,
      availableOn: input.activeLeaseEndDate,
      source: "lease",
      listed: true,
    };
  }
  return { state: "occupied", availableNow: false, availableOn: null, source: null, listed: false };
}

/**
 * Sort comparator for vacancy rows: available-now first, then by soonest
 * availability date ascending. Stable for equal keys.
 */
export function compareVacancy(
  a: Pick<Vacancy, "availableNow" | "availableOn">,
  b: Pick<Vacancy, "availableNow" | "availableOn">,
): number {
  if (a.availableNow !== b.availableNow) return a.availableNow ? -1 : 1;
  const at = a.availableOn?.getTime() ?? 0;
  const bt = b.availableOn?.getTime() ?? 0;
  return at - bt;
}
