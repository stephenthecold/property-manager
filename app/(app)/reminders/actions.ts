"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  sendBulkOverdueReminders,
  sendReminder,
} from "@/lib/services/reminders";
import type { ReminderType } from "@/lib/generated/prisma/enums";

export interface SendReminderState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const REMINDER_TYPES: ReminderType[] = [
  "rent_due_soon",
  "rent_overdue",
  "partial_balance",
  "payment_receipt",
  "manual",
];

export async function sendReminderAction(
  _prev: SendReminderState,
  fd: FormData,
): Promise<SendReminderState> {
  await requireCapability("reminders.send");

  const tenantId = String(fd.get("tenantId") ?? "").trim();
  if (!tenantId) return { error: "Missing tenant." };
  const leaseId = String(fd.get("leaseId") ?? "").trim() || null;

  const typeRaw = String(fd.get("reminderType") ?? "").trim();
  if (!REMINDER_TYPES.includes(typeRaw as ReminderType)) {
    return { error: "Choose a valid reminder type." };
  }
  const reminderType = typeRaw as ReminderType;

  // Empty body -> null so the default template applies (manual requires a body).
  const messageBody = String(fd.get("messageBody") ?? "").trim() || null;
  if (reminderType === "manual" && !messageBody) {
    return { error: "Enter a message for a manual reminder." };
  }

  try {
    const result = await sendReminder({
      tenantId,
      leaseId,
      reminderType,
      messageBody,
      actor: await auditActor(),
    });
    revalidatePath("/reminders");
    revalidatePath("/tenants", "layout");

    if (result.status === "sent") {
      return { ok: true, message: "Reminder sent." };
    }
    if (result.status === "skipped") {
      return {
        error:
          result.error === "duplicate"
            ? "Already sent for this period."
            : (result.error ?? "Reminder skipped."),
      };
    }
    return { error: `Send failed: ${result.error ?? "unknown"}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send reminder." };
  }
}

export async function sendBulkOverdueRemindersAction(): Promise<void> {
  await requireCapability("reminders.send");
  const r = await sendBulkOverdueReminders(await auditActor());
  revalidatePath("/reminders");
  redirect(
    `/reminders?bulk=${r.sent}-${r.failed}-${r.skippedNoConsent}-${r.skippedNoPhone}-${r.skippedDuplicate}`,
  );
}
