/**
 * Daily maintenance-reminder sweep (worker, same cron as rent reminders).
 * Sends consent-gated SMS to tenants ahead of scheduled recurring tasks
 * (RecurringTask.dueDay) and one-off jobs (MaintenanceJob.dueDate) that have
 * notifyTenants enabled. Idempotent per occurrence via the Reminder partial
 * unique — periodKey is "yyyy-MM-dd/mt:<taskOrJobId>".
 */

export interface MaintenanceRemindersResult {
  sent: number;
  failed: number;
  skipped: number;
}

export async function runMaintenanceReminders(
  _now: Date,
): Promise<MaintenanceRemindersResult> {
  // Implemented with the maintenance-scheduling feature; wired into the
  // worker ahead of time so the cron seam exists.
  return { sent: 0, failed: 0, skipped: 0 };
}
