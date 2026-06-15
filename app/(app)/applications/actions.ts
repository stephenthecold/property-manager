"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  convertApplicationToTenant,
  sendApplyLink,
  setApplicationStatus,
} from "@/lib/services/applications";
import type { RentalApplicationStatus } from "@/lib/generated/prisma/enums";

export interface AppActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const str = (fd: FormData, key: string): string =>
  String(fd.get(key) ?? "").trim();

const STATUSES: RentalApplicationStatus[] = [
  "submitted",
  "reviewing",
  "approved",
  "declined",
  "withdrawn",
];

export async function setStatusAction(
  _prev: AppActionState,
  fd: FormData,
): Promise<AppActionState> {
  await requireCapability("applications.manage");
  const id = str(fd, "id");
  const statusRaw = str(fd, "status");
  if (!id || !STATUSES.includes(statusRaw as RentalApplicationStatus)) {
    return { error: "Invalid application or status." };
  }
  try {
    await setApplicationStatus(
      id,
      statusRaw as RentalApplicationStatus,
      str(fd, "reviewerNotes") || null,
      await auditActor(),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to update application." };
  }
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
  return { ok: true, message: "Application updated." };
}

export async function convertAction(fd: FormData): Promise<void> {
  await requireCapability("applications.manage");
  const id = str(fd, "id");
  if (!id) throw new Error("Missing application id.");
  const { tenantId } = await convertApplicationToTenant(id, await auditActor());
  revalidatePath("/applications");
  redirect(`/tenants/${tenantId}`);
}

export async function sendLinkAction(
  _prev: AppActionState,
  fd: FormData,
): Promise<AppActionState> {
  await requireCapability("applications.manage");
  const email = str(fd, "email") || null;
  const phone = str(fd, "phone") || null;
  const unitId = str(fd, "unitId") || null;
  if (!email && !phone) {
    return { error: "Enter an email or phone number to send the link to." };
  }
  try {
    const r = await sendApplyLink({ email, phone, unitId }, await auditActor());
    if (!r.emailed && !r.texted) {
      return { error: r.errors.join("; ") || "Nothing was sent." };
    }
    const sent = [r.emailed && "emailed", r.texted && "texted"].filter(Boolean).join(" & ");
    let message = `Apply link ${sent}.`;
    if (r.errors.length) message += ` Some channels failed: ${r.errors.join("; ")}`;
    return { ok: true, message };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to send the apply link." };
  }
}
