/**
 * Worker-liveness for billing. The dashboard warns when the billing worker
 * hasn't completed a run recently, so a stuck worker or a cron that isn't firing
 * is visible instead of silently skipping rent charges. PURE + unit-tested; the
 * page supplies `AppSettings.lastBillingRunAt` (stamped by the worker) and `now`.
 *
 * The default threshold (26h) comfortably clears both cadences the worker
 * supports: the shipped hourly billing updates the stamp every hour, and a
 * legacy daily cron every ~24h — so only a genuinely stalled worker trips it.
 * `null` (never run) is always stale — that's the "worker isn't running at all"
 * case we most want to surface.
 */

export const BILLING_STALE_HOURS = 26;

export function billingRunIsStale(
  lastRunAt: Date | null | undefined,
  now: Date,
  maxAgeHours: number = BILLING_STALE_HOURS,
): boolean {
  if (!lastRunAt) return true;
  const ageMs = now.getTime() - lastRunAt.getTime();
  // A future stamp (clock skew) is not "stale".
  if (ageMs < 0) return false;
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}
