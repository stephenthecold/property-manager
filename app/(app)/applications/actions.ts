"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  convertApplicationToTenant,
  sendApplyLink,
  setApplicationStatus,
  updateApplicationFields,
} from "@/lib/services/applications";
import {
  cancelBackgroundCheck,
  requestBackgroundCheck,
} from "@/lib/services/background-check";
import { toCents } from "@/lib/money";
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

/** One-click decline: set the application to "declined". */
export async function declineAction(fd: FormData): Promise<void> {
  await requireCapability("applications.manage");
  const id = str(fd, "id");
  if (!id) throw new Error("Missing application id.");
  await setApplicationStatus(id, "declined", str(fd, "reviewerNotes") || null, await auditActor());
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
}

/** Staff edit of a submitted application's fields. */
export async function editApplicationAction(
  _prev: AppActionState,
  fd: FormData,
): Promise<AppActionState> {
  await requireCapability("applications.manage");
  const id = str(fd, "id");
  const firstName = str(fd, "firstName");
  const lastName = str(fd, "lastName");
  if (!id || !firstName || !lastName) {
    return { error: "First and last name are required." };
  }

  const moveRaw = str(fd, "desiredMoveInDate");
  let desiredMoveInDate: Date | null = null;
  if (moveRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveRaw)) {
      return { error: "Enter a valid desired move-in date." };
    }
    desiredMoveInDate = new Date(`${moveRaw}T00:00:00Z`);
  }
  const incomeRaw = str(fd, "monthlyIncome");
  let monthlyIncomeCents: bigint | null = null;
  if (incomeRaw) {
    try {
      monthlyIncomeCents = toCents(incomeRaw);
    } catch {
      return { error: "Enter a valid monthly income amount." };
    }
  }

  try {
    await updateApplicationFields(
      id,
      {
        firstName,
        lastName,
        email: str(fd, "email") || null,
        phone: str(fd, "phone") || null,
        currentAddress: str(fd, "currentAddress") || null,
        desiredMoveInDate,
        monthlyIncomeCents,
        employer: str(fd, "employer") || null,
        message: str(fd, "message") || null,
      },
      await auditActor(),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save application." };
  }
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
  return { ok: true, message: "Application saved." };
}

/** Request a tenant-screening background check for an application. */
export async function requestBackgroundCheckAction(fd: FormData): Promise<void> {
  await requireCapability("applications.manage");
  const id = str(fd, "id");
  if (!id) throw new Error("Missing application id.");
  await requestBackgroundCheck(id, await auditActor());
  revalidatePath(`/applications/${id}`);
}

/** Cancel a still-pending background check. */
export async function cancelBackgroundCheckAction(fd: FormData): Promise<void> {
  await requireCapability("applications.manage");
  const id = str(fd, "id");
  const checkId = str(fd, "checkId");
  if (!id || !checkId) throw new Error("Missing application or check id.");
  await cancelBackgroundCheck(checkId, await auditActor());
  revalidatePath(`/applications/${id}`);
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
