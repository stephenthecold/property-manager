"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit/audit";
import { prisma } from "@/lib/db";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  getAppSettings,
  resolveSmsProvider,
  saveMessagingSettings,
} from "@/lib/services/app-settings";
import type { ReminderType } from "@/lib/generated/prisma/enums";

export interface MessagingState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const TEMPLATE_TYPES: ReminderType[] = [
  "rent_due_soon",
  "rent_overdue",
  "partial_balance",
  "payment_receipt",
];

const str = (fd: FormData, key: string): string | null =>
  String(fd.get(key) ?? "").trim() || null;

export async function saveMessagingAction(
  _prev: MessagingState,
  fd: FormData,
): Promise<MessagingState> {
  await requireCapability("messaging.settings");

  const providerRaw = String(fd.get("smsProvider") ?? "");
  const smsProvider =
    providerRaw === "stub" || providerRaw === "twilio" || providerRaw === "telnyx"
      ? providerRaw
      : null;

  const tokenRaw = String(fd.get("smsAuthToken") ?? "");
  const accountSid = str(fd, "smsAccountSid");
  const fromNumber = str(fd, "smsFromNumber");

  if (smsProvider === "twilio") {
    if (!accountSid || !fromNumber) {
      return { error: "Twilio requires an Account SID and a From number." };
    }
    const hasStored = (await getAppSettings()).smsHasAuthToken;
    if (!tokenRaw && !hasStored) {
      return { error: "Twilio requires an auth token." };
    }
  }
  if (smsProvider === "telnyx") {
    if (!fromNumber) {
      return { error: "Telnyx requires a From number." };
    }
    const hasStored = (await getAppSettings()).smsHasAuthToken;
    if (!tokenRaw && !hasStored) {
      return { error: "Telnyx requires an API key." };
    }
  }

  const daysRaw = String(fd.get("reminderDueSoonDays") ?? "").trim();
  let reminderDueSoonDays: number | null = null;
  if (daysRaw !== "") {
    const n = Number(daysRaw);
    if (!Number.isInteger(n) || n < 0 || n > 28) {
      return { error: "Due-soon days must be a whole number between 0 and 28." };
    }
    reminderDueSoonDays = n;
  }

  const smsTemplates: Partial<Record<ReminderType, string>> = {};
  for (const t of TEMPLATE_TYPES) {
    const body = String(fd.get(`tpl_${t}`) ?? "").trim();
    if (body) smsTemplates[t] = body;
  }

  try {
    await saveMessagingSettings(
      {
        smsEnabled: fd.get("smsEnabled") === "on",
        smsProvider,
        smsAccountSid: accountSid,
        // Blank keeps the stored token; switching provider away from twilio
        // leaves it stored but unused.
        smsAuthToken: tokenRaw === "" ? undefined : tokenRaw,
        smsFromNumber: fromNumber,
        reminderDueSoonDays,
        dueSoonRemindersEnabled: fd.get("dueSoonRemindersEnabled") === "on",
        overdueRemindersEnabled: fd.get("overdueRemindersEnabled") === "on",
        smsTemplates,
      },
      await auditActor(),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save settings." };
  }

  revalidatePath("/settings/messaging");
  return { ok: true, message: "Messaging settings saved." };
}

export async function sendTestSmsAction(
  _prev: MessagingState,
  fd: FormData,
): Promise<MessagingState> {
  await requireCapability("messaging.settings");
  const to = String(fd.get("testPhone") ?? "").trim();
  if (!to) return { error: "Enter a phone number for the test message." };

  const settings = await getAppSettings();
  if (!settings.smsEnabled) {
    return { error: "SMS sending is disabled — enable it above and save first." };
  }

  const actor = await auditActor();
  try {
    const provider = await resolveSmsProvider();
    const result = await provider.send({
      to,
      body: `Test message from ${settings.businessName}. SMS is configured correctly.`,
    });
    await writeAudit(prisma, {
      ...actor,
      action: "settings.sms_test",
      entityType: "AppSettings",
      entityId: "singleton",
      after: {
        provider: result.provider,
        status: result.status,
        toLast4: to.slice(-4),
      },
    });
    if (result.status === "failed") {
      return { error: `Test send failed: ${result.error ?? "unknown error"}` };
    }
    return {
      ok: true,
      message:
        result.provider === "stub"
          ? "Test accepted by the stub provider (no real SMS is sent — check the server log)."
          : `Test message ${result.status} via ${result.provider}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Test send failed." };
  }
}
