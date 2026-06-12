import { getEnv } from "@/lib/config/env";
import {
  getAppSettings,
  resolveEmailProvider,
  resolveSmsProvider,
} from "@/lib/services/app-settings";
import { staffNotificationRecipients } from "@/lib/services/staff-digest";

/**
 * Event-driven staff alerts (vs. the weekly cron digests): currently the
 * "tenant wants to pay cash — arrange pickup" notification, sent the moment a
 * tenant submits the request from the portal. Email goes to every opted-in
 * manager+ (notifyCashPickup); staff with a phone on file also get an SMS,
 * since pickups are time-sensitive. Best-effort by design: a provider failure
 * is logged and counted, never thrown — the tenant's request row is already
 * committed and staff can still see it in the queue.
 */

export interface CashPickupAlertInput {
  tenantName: string;
  propertyName: string | null;
  unitLabel: string | null;
  /** Tenant-supplied note, already trimmed; may be empty. */
  message: string;
}

export interface StaffAlertResult {
  emailsSent: number;
  smsSent: number;
  failed: number;
}

export async function notifyStaffCashPickup(
  input: CashPickupAlertInput,
): Promise<StaffAlertResult> {
  const result: StaffAlertResult = { emailsSent: 0, smsSent: 0, failed: 0 };
  const settings = await getAppSettings();
  const recipients = await staffNotificationRecipients("notifyCashPickup");
  if (recipients.length === 0) return result;

  const where = [input.propertyName, input.unitLabel].filter(Boolean).join(" · ");
  const queueUrl = `${getEnv().APP_URL.replace(/\/+$/, "")}/requests`;
  const subject = `Cash rent pickup requested: ${input.tenantName} — ${settings.businessName}`;
  const body = [
    `${input.tenantName}${where ? ` (${where})` : ""} asked to pay rent in cash and needs a pickup arranged.`,
    input.message ? `Note from tenant: ${input.message}` : "",
    `Open the request queue: ${queueUrl}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const smsBody = `${settings.businessName}: ${input.tenantName}${where ? ` (${where})` : ""} requests a cash rent pickup. See the Requests page.`;

  if (settings.emailEnabled) {
    try {
      const provider = await resolveEmailProvider();
      for (const r of recipients) {
        try {
          const res = await provider.send({ to: r.email, subject, text: body });
          if (res.status === "failed") result.failed++;
          else result.emailsSent++;
        } catch (e) {
          result.failed++;
          console.error("[staff-alerts] cash-pickup email failed:", e);
        }
      }
    } catch (e) {
      // Unconfigured email — SMS below may still reach someone.
      console.error("[staff-alerts] email provider unavailable:", e);
    }
  }

  if (settings.smsEnabled) {
    const withPhone = recipients.filter((r) => (r.phone ?? "").trim() !== "");
    if (withPhone.length > 0) {
      try {
        const sms = await resolveSmsProvider();
        for (const r of withPhone) {
          try {
            const res = await sms.send({ to: r.phone as string, body: smsBody });
            if (res.status === "failed") result.failed++;
            else result.smsSent++;
          } catch (e) {
            result.failed++;
            console.error("[staff-alerts] cash-pickup SMS failed:", e);
          }
        }
      } catch (e) {
        console.error("[staff-alerts] SMS provider unavailable:", e);
      }
    }
  }

  return result;
}
