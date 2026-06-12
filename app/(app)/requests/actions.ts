"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import {
  convertRequestToJob,
  updateTenantRequestStatus,
} from "@/lib/services/tenant-requests";
import type { TenantRequestStatus } from "@/lib/generated/prisma/enums";

/** Guard failures land back on the queue as a banner (never thrown). */
function fail(message: string): never {
  redirect(`/requests?error=${encodeURIComponent(message)}`);
}

const STATUSES: TenantRequestStatus[] = ["open", "in_progress", "done", "declined"];

export async function setRequestStatusAction(fd: FormData): Promise<void> {
  await requireCapability("portal.manage");
  const requestId = String(fd.get("requestId") ?? "").trim();
  const status = String(fd.get("status") ?? "").trim() as TenantRequestStatus;
  if (!requestId || !STATUSES.includes(status)) fail("Invalid request or status.");
  const note = String(fd.get("resolutionNote") ?? "").trim() || null;
  const result = await updateTenantRequestStatus({
    requestId,
    status,
    resolutionNote: note,
    actor: await auditActor(),
  });
  if (!result.ok) fail(result.error ?? "Update failed.");
  revalidatePath("/requests");
}

export async function convertRequestToJobAction(fd: FormData): Promise<void> {
  await requireCapability("portal.manage");
  await assertModuleEnabled("maintenance");
  const requestId = String(fd.get("requestId") ?? "").trim();
  if (!requestId) fail("Invalid request.");
  const result = await convertRequestToJob({
    requestId,
    actor: await auditActor(),
  });
  if (!result.ok) fail(result.error ?? "Conversion failed.");
  revalidatePath("/requests");
  revalidatePath("/maintenance");
}
