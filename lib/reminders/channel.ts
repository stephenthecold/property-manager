import type { NotificationChannel } from "@/lib/generated/prisma/enums";

/**
 * Pure channel/consent resolution for reminders. Consent is **absolute and
 * per-channel**: a reminder only goes out on the tenant's preferred channel,
 * and only when that channel's master switch is on, the tenant has consented to
 * that channel, AND a destination exists. We never cross-send (e.g. fall back
 * from email to SMS) — that would deliver on a channel the tenant didn't choose
 * or consent to. DB-free and unit-tested; the service layer only supplies rows.
 */

export interface ReminderDeliveryInput {
  preferredChannel: NotificationChannel;
  smsConsent: boolean;
  phone: string | null | undefined;
  emailConsent: boolean;
  email: string | null | undefined;
  /** Master SMS switch (AppSettings.smsEnabled). */
  smsEnabled: boolean;
  /** Master email switch (AppSettings.emailEnabled). */
  emailEnabled: boolean;
}

export type ReminderSkipReason =
  | "channel disabled"
  | "no consent"
  | "no contact";

export type ReminderDelivery =
  | { ok: true; channel: NotificationChannel; destination: string }
  | { ok: false; reason: ReminderSkipReason };

function clean(v: string | null | undefined): string {
  return (v ?? "").trim();
}

export function resolveReminderDelivery(
  i: ReminderDeliveryInput,
): ReminderDelivery {
  if (i.preferredChannel === "email") {
    if (!i.emailEnabled) return { ok: false, reason: "channel disabled" };
    if (!i.emailConsent) return { ok: false, reason: "no consent" };
    const email = clean(i.email);
    if (!email) return { ok: false, reason: "no contact" };
    return { ok: true, channel: "email", destination: email };
  }
  // Default / "sms".
  if (!i.smsEnabled) return { ok: false, reason: "channel disabled" };
  if (!i.smsConsent) return { ok: false, reason: "no consent" };
  const phone = clean(i.phone);
  if (!phone) return { ok: false, reason: "no contact" };
  return { ok: true, channel: "sms", destination: phone };
}
