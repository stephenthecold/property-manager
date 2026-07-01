import { getEnv } from "@/lib/config/env";
import { formatCurrency } from "@/lib/money";
import { toE164ForSend } from "@/lib/sms/phone";
import {
  getAppSettings,
  resolveEmailProvider,
  resolveSmsProvider,
} from "@/lib/services/app-settings";
import {
  staffNotificationRecipients,
  type NotifyFlag,
} from "@/lib/services/staff-digest";

/**
 * Event-driven staff alerts (vs. the weekly cron digests): sent the moment
 * something happens — a tenant requests a cash pickup, a payment posts, or a
 * tenant submits a maintenance request. Each goes to the manager+ staff who
 * opted into that notification (Settings → Notifications; admins set anyone's
 * from Settings → Users): email to all, plus a text to those with a mobile on
 * file. Best-effort by design — a provider failure is logged and counted, never
 * thrown, so the originating action (request / payment) is never affected.
 */

export interface StaffAlertResult {
  emailsSent: number;
  smsSent: number;
  failed: number;
}

const appUrl = () => getEnv().APP_URL.replace(/\/+$/, "");

/** "Property · Unit" locator, or "" when neither is known. */
function whereLabel(propertyName: string | null, unitLabel: string | null): string {
  return [propertyName, unitLabel].filter(Boolean).join(" · ");
}

/**
 * Dispatch one alert to every staffer opted into `flag`: email to all, plus a
 * text to those with a mobile (normalized to E.164 at the wire, since providers
 * reject bare 10-digit numbers). Fully isolated — every provider call is caught;
 * the function never throws and the caller can ignore the result.
 */
async function sendStaffAlert(i: {
  flag: NotifyFlag;
  subject: string;
  emailBody: string;
  smsBody: string;
}): Promise<StaffAlertResult> {
  const result: StaffAlertResult = { emailsSent: 0, smsSent: 0, failed: 0 };
  const settings = await getAppSettings();
  const recipients = await staffNotificationRecipients(i.flag);
  if (recipients.length === 0) return result;

  if (settings.emailEnabled) {
    try {
      const provider = await resolveEmailProvider();
      for (const r of recipients) {
        try {
          const res = await provider.send({
            to: r.email,
            subject: i.subject,
            text: i.emailBody,
          });
          if (res.status === "failed") result.failed++;
          else result.emailsSent++;
        } catch (e) {
          result.failed++;
          console.error("[staff-alerts] email failed:", e);
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
          const to = toE164ForSend(r.phone) ?? (r.phone as string);
          try {
            const res = await sms.send({ to, body: i.smsBody });
            if (res.status === "failed") result.failed++;
            else result.smsSent++;
          } catch (e) {
            result.failed++;
            console.error("[staff-alerts] SMS failed:", e);
          }
        }
      } catch (e) {
        console.error("[staff-alerts] SMS provider unavailable:", e);
      }
    }
  }

  return result;
}

export interface CashPickupAlertInput {
  tenantName: string;
  propertyName: string | null;
  unitLabel: string | null;
  /** Tenant-supplied note, already trimmed; may be empty. */
  message: string;
}

/** A tenant asked to pay rent in cash and needs a pickup arranged (time-sensitive). */
export async function notifyStaffCashPickup(
  input: CashPickupAlertInput,
): Promise<StaffAlertResult> {
  const { businessName } = await getAppSettings();
  const where = whereLabel(input.propertyName, input.unitLabel);
  const subject = `Cash rent pickup requested: ${input.tenantName} — ${businessName}`;
  const emailBody = [
    `${input.tenantName}${where ? ` (${where})` : ""} asked to pay rent in cash and needs a pickup arranged.`,
    input.message ? `Note from tenant: ${input.message}` : "",
    `Open the request queue: ${appUrl()}/requests`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const smsBody = `${businessName}: ${input.tenantName}${where ? ` (${where})` : ""} requests a cash rent pickup. See the Requests page.`;
  return sendStaffAlert({ flag: "notifyCashPickup", subject, emailBody, smsBody });
}

export interface PaymentRecordedAlertInput {
  tenantName: string;
  tenantId: string;
  propertyName: string | null;
  unitLabel: string | null;
  amountCents: bigint;
  currency: string;
  /** PaymentMethod enum value (e.g. "cash_app"); underscores are humanized. */
  method: string;
}

/**
 * Fired the moment a payment posts to the ledger — from any path (staff-recorded,
 * confirmed tenant self-report, online gateway). Called best-effort AFTER the
 * payment commits, so it can never affect the payment.
 */
export async function notifyStaffPaymentRecorded(
  input: PaymentRecordedAlertInput,
): Promise<StaffAlertResult> {
  const { businessName } = await getAppSettings();
  const where = whereLabel(input.propertyName, input.unitLabel);
  const amount = formatCurrency(input.amountCents, input.currency);
  const method = input.method.replace(/_/g, " ");
  const subject = `Payment recorded: ${amount} — ${input.tenantName} — ${businessName}`;
  const emailBody = [
    `${input.tenantName}${where ? ` (${where})` : ""} — payment of ${amount} recorded (${method}).`,
    `View the tenant's ledger: ${appUrl()}/tenants/${input.tenantId}`,
  ].join("\n\n");
  const smsBody = `${businessName}: ${amount} payment recorded for ${input.tenantName}${where ? ` (${where})` : ""} — ${method}.`;
  return sendStaffAlert({
    flag: "notifyPaymentRecorded",
    subject,
    emailBody,
    smsBody,
  });
}

export interface MaintenanceRequestAlertInput {
  tenantName: string;
  propertyName: string | null;
  unitLabel: string | null;
  /** The tenant's description of the issue; may be empty. */
  message: string;
}

/** Fired when a tenant submits a maintenance request from the portal. */
export async function notifyStaffMaintenanceRequest(
  input: MaintenanceRequestAlertInput,
): Promise<StaffAlertResult> {
  const { businessName } = await getAppSettings();
  const where = whereLabel(input.propertyName, input.unitLabel);
  const subject = `New maintenance request: ${input.tenantName} — ${businessName}`;
  const emailBody = [
    `${input.tenantName}${where ? ` (${where})` : ""} submitted a maintenance request:`,
    input.message || "(no description provided)",
    `Open the request queue: ${appUrl()}/requests`,
  ].join("\n\n");
  const smsBody = `${businessName}: new maintenance request from ${input.tenantName}${where ? ` (${where})` : ""}. See the Requests page.`;
  return sendStaffAlert({
    flag: "notifyMaintenanceRequest",
    subject,
    emailBody,
    smsBody,
  });
}
