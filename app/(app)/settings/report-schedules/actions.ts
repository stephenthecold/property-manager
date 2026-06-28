"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  createReportSchedule,
  deleteReportSchedule,
} from "@/lib/services/report-schedules";
import { getFormString as str, type FormState } from "@/lib/forms";

export async function createReportScheduleAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("reports.schedule");
  const res = await createReportSchedule({
    reportType: str(fd, "reportType"),
    format: str(fd, "format"),
    cadence: str(fd, "cadence"),
    recipientEmailsRaw: str(fd, "recipientEmails"),
    actor: await auditActor(),
  });
  if ("error" in res) return { error: res.error };
  revalidatePath("/settings/report-schedules");
  return { ok: true };
}

export async function deleteReportScheduleAction(fd: FormData): Promise<void> {
  await requireCapability("reports.schedule");
  const id = str(fd, "scheduleId");
  if (!id) throw new Error("Missing schedule id.");
  await deleteReportSchedule(id, await auditActor());
  revalidatePath("/settings/report-schedules");
}
