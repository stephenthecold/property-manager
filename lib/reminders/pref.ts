import type { NotificationChannel } from "@/lib/generated/prisma/enums";

/**
 * Pure resolution of a tenant's EFFECTIVE reminder channel for a given reminder
 * type, layering an optional per-event override on top of the tenant's single
 * global `reminderChannel`. DB-free and unit-tested; the service layer only
 * supplies the stored rows.
 *
 * A `TenantReminderPref.channel` is stored as a plain string (not the
 * NotificationChannel enum) precisely because it carries one extra state the
 * enum doesn't: "off" — the tenant has muted this reminder type entirely. The
 * effective channel is therefore `NotificationChannel | null`, where `null`
 * means "do not send this type at all" and short-circuits before any
 * consent/contact resolution. When there is no override the global channel is
 * used unchanged, so existing tenants behave exactly as before.
 */

/** The three states a per-event preference can take. "off" mutes the type. */
export type ReminderPrefChannel = NotificationChannel | "off";

export const REMINDER_PREF_CHANNELS: readonly ReminderPrefChannel[] = [
  "sms",
  "email",
  "off",
] as const;

/** Narrow an untrusted stored/form string to a ReminderPrefChannel, or null. */
export function parseReminderPrefChannel(
  v: string | null | undefined,
): ReminderPrefChannel | null {
  return v != null && (REMINDER_PREF_CHANNELS as readonly string[]).includes(v)
    ? (v as ReminderPrefChannel)
    : null;
}

/**
 * The effective channel for (tenant, reminderType):
 *   - a valid per-event override wins ("off" → null = suppressed);
 *   - otherwise fall back to the tenant's global `reminderChannel`.
 * An unrecognized/absent override is treated as "no override".
 */
export function resolveEffectiveChannel(i: {
  globalChannel: NotificationChannel;
  /** Raw stored override for THIS reminder type (TenantReminderPref.channel). */
  override: string | null | undefined;
}): NotificationChannel | null {
  const override = parseReminderPrefChannel(i.override);
  if (override === "off") return null;
  if (override === "sms" || override === "email") return override;
  return i.globalChannel;
}
