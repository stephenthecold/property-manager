/**
 * Pure unit-vacancy classification (DB-free, clock-injected) — unit-tested.
 *
 * Two orthogonal inputs, never one overloaded enum:
 *   - serviceStatus (MANUAL): in_service | maintenance | unavailable
 *   - whether the unit has an active lease (DERIVED, authoritative)
 *   - availableFromDate (MANUAL forward-looking override)
 *
 * Display state, in priority order (occupancy ALWAYS wins over serviceability —
 * a leased unit pulled for repairs is still occupied):
 *   occupied    → has an active lease, no known end (not listed)
 *   upcoming    → has an active lease ending, or a manual future date
 *   unavailable → not leased + off-market (not listed in the outlook)
 *   maintenance → not leased + out of service, but TRACKABLE in the outlook
 *   vacant      → not leased + in service → available now
 *
 * Because occupancy is asked of the lease and serviceability of the manual
 * field, a unit can never show two contradictory states.
 */

export type ServiceStatusLike = "in_service" | "maintenance" | "unavailable";

export type VacancyState =
  | "vacant"
  | "upcoming"
  | "occupied"
  | "maintenance"
  | "unavailable";

export interface VacancyInput {
  serviceStatus: ServiceStatusLike;
  /** Staff-set expected availability date (override); null when unset. */
  availableFromDate: Date | null;
  /** End date of the active lease, if any (null = open-ended / no lease). */
  activeLeaseEndDate: Date | null;
  /** Whether the unit currently has an active/month_to_month lease. */
  hasActiveLease: boolean;
}

export interface Vacancy {
  state: VacancyState;
  /** Available right now (in service, no lease, no future hold). */
  availableNow: boolean;
  /** Future availability date, or null when availableNow / occupied / off-market. */
  availableOn: Date | null;
  /** Where availableOn came from. */
  source: "now" | "lease" | "manual" | null;
  /** Should this unit appear in the dashboard vacancy outlook? */
  listed: boolean;
}

const isFuture = (d: Date, now: Date): boolean => d.getTime() > now.getTime();

export function computeVacancy(input: VacancyInput, now: Date): Vacancy {
  const manualFuture =
    input.availableFromDate && isFuture(input.availableFromDate, now)
      ? input.availableFromDate
      : null;

  // Occupancy wins: an active lease means the unit is taken, regardless of
  // serviceability. A leased unit pulled for repairs is still "occupied" — its
  // maintenance is tracked via maintenance jobs, never the vacancy outlook.
  if (input.hasActiveLease) {
    const leaseEnd =
      input.activeLeaseEndDate && isFuture(input.activeLeaseEndDate, now)
        ? input.activeLeaseEndDate
        : null;
    const date = manualFuture ?? leaseEnd;
    if (date) {
      return {
        state: "upcoming",
        availableNow: false,
        availableOn: date,
        source: manualFuture ? "manual" : "lease",
        listed: true,
      };
    }
    return { state: "occupied", availableNow: false, availableOn: null, source: null, listed: false };
  }

  // Not leased — serviceability now determines availability.
  // Unavailable → off-market, NOT in the outlook.
  if (input.serviceStatus === "unavailable") {
    return {
      state: "unavailable",
      availableNow: false,
      availableOn: manualFuture,
      source: manualFuture ? "manual" : null,
      listed: false,
    };
  }
  // Maintenance → trackable in the outlook, never "now".
  if (input.serviceStatus === "maintenance") {
    return {
      state: "maintenance",
      availableNow: false,
      availableOn: manualFuture,
      source: manualFuture ? "manual" : null,
      listed: true,
    };
  }
  // In service, no lease: available now (or on a future manual date).
  if (manualFuture) {
    return { state: "upcoming", availableNow: false, availableOn: manualFuture, source: "manual", listed: true };
  }
  return { state: "vacant", availableNow: true, availableOn: null, source: "now", listed: true };
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
