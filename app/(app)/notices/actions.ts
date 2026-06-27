"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import { parseNoticeType } from "@/lib/notices/templates";
import {
  createNotice,
  markNoticeServed,
  updateNoticeDraft,
  voidNotice,
} from "@/lib/services/notices";
import { getFormString as str, type FormState } from "@/lib/forms";

const SERVE_METHODS = ["hand", "mail", "posted", "email"];

/** Resolve a date-only field to a Date in the lease's property timezone. */
async function dateInLeaseTz(
  leaseId: string,
  raw: string,
): Promise<Date | null | undefined> {
  if (!raw) return null;
  const lease = await prisma.lease.findUnique({
    where: { id: leaseId },
    select: { unit: { select: { property: { select: { timezone: true } } } } },
  });
  if (!lease) return undefined;
  return parseDateOnlyInZone(raw, lease.unit.property.timezone) ?? undefined;
}

export async function createNoticeAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("notices.manage");
  await assertModuleEnabled("notices");

  const leaseId = str(fd, "leaseId");
  if (!leaseId) return { error: "Pick a lease." };
  const type = parseNoticeType(str(fd, "type"));

  const effRaw = str(fd, "effectiveDate");
  const effectiveDate = await dateInLeaseTz(leaseId, effRaw);
  if (effectiveDate === undefined) return { error: "Lease not found, or invalid date." };

  const res = await createNotice({
    leaseId,
    type,
    effectiveDate,
    subject: str(fd, "subject") || null,
    body: str(fd, "body") || null,
    actor: await auditActor(),
  });
  if ("error" in res) return { error: res.error };

  revalidatePath("/notices");
  return { ok: true };
}

export async function updateNoticeAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("notices.manage");
  await assertModuleEnabled("notices");

  const id = str(fd, "noticeId");
  if (!id) return { error: "Missing notice id." };
  const subject = str(fd, "subject");
  const body = str(fd, "body");
  if (!subject || !body) return { error: "Subject and body are required." };

  const notice = await prisma.notice.findUnique({
    where: { id },
    select: { leaseId: true },
  });
  if (!notice) return { error: "Notice not found." };
  const effectiveDate = await dateInLeaseTz(notice.leaseId, str(fd, "effectiveDate"));
  if (effectiveDate === undefined) return { error: "Invalid date." };

  const res = await updateNoticeDraft({
    id,
    subject,
    body,
    effectiveDate,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Update failed." };

  revalidatePath("/notices");
  return { ok: true };
}

export async function markNoticeServedAction(fd: FormData): Promise<void> {
  await requireCapability("notices.manage");
  await assertModuleEnabled("notices");
  const id = String(fd.get("noticeId") ?? "").trim();
  if (!id) throw new Error("Missing notice id.");
  const methodRaw = String(fd.get("servedMethod") ?? "").trim();
  const servedMethod = SERVE_METHODS.includes(methodRaw) ? methodRaw : "hand";
  await markNoticeServed({
    id,
    servedMethod,
    servedAt: new Date(),
    actor: await auditActor(),
  });
  revalidatePath("/notices");
}

export async function voidNoticeAction(fd: FormData): Promise<void> {
  await requireCapability("notices.manage");
  await assertModuleEnabled("notices");
  const id = String(fd.get("noticeId") ?? "").trim();
  if (!id) throw new Error("Missing notice id.");
  await voidNotice({ id, actor: await auditActor() });
  revalidatePath("/notices");
}
