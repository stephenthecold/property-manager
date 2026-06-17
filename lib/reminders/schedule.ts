/**
 * Pure resolution of the reminder/digest worker schedule. The worker runs a
 * daily sweep on a cron expression; an operator can now set just the send HOUR
 * in Settings (DB-over-env), while the full `REMINDER_CRON` env stays as an
 * escape hatch for anything fancier (specific weekdays, etc.).
 *
 * Precedence (DB-over-env): a valid saved hour wins → `0 H * * *`; otherwise the
 * env cron expression; otherwise the shipped 09:00 default. No clock, no DB.
 */

export const DEFAULT_REMINDER_CRON = "0 9 * * *"; // 09:00 daily

/** A valid 0–23 integer hour, or null (use the env cron / default instead). */
export function sanitizeReminderSendHour(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isInteger(value) || value < 0 || value > 23) {
    return null;
  }
  return value;
}

/**
 * The cron expression the worker should schedule on, given the saved hour and
 * the (optional) `REMINDER_CRON` env override.
 */
export function reminderCron(
  savedHour: number | null | undefined,
  envCron?: string | null,
): string {
  const hour = sanitizeReminderSendHour(savedHour);
  if (hour != null) return `0 ${hour} * * *`;
  const env = envCron?.trim();
  return env && env.length > 0 ? env : DEFAULT_REMINDER_CRON;
}
