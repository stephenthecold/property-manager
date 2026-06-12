/**
 * Weekly staff overdue-rent digest (worker, STAFF_DIGEST_CRON — Mondays by
 * default). Emails every active owner/admin/finance/manager user the list of
 * overdue leases (tenant, unit, balance, aging) via the configured email
 * provider. Cron-only (never runs at worker startup) so restarts cannot
 * double-send.
 */

export interface StaffDigestResult {
  sent: number;
  skipped: number;
  reason?: string;
}

export async function runWeeklyStaffDigest(
  _now: Date,
): Promise<StaffDigestResult> {
  // Implemented with the staff-digest feature; wired into the worker ahead
  // of time so the cron seam exists.
  return { sent: 0, skipped: 0, reason: "not implemented" };
}
