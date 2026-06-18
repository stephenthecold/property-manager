"use server";

import { redirect } from "next/navigation";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { saveMaintenancePhotos } from "@/lib/services/maintenance-photos";

/**
 * Staff "before/after" photos on a work order. Reuses the shared, magic-byte-
 * validated saver; feedback rides back as a query param (no thrown errors).
 */
export async function addMaintenancePhotosAction(fd: FormData): Promise<void> {
  await requireCapability("maintenance.manage");
  const { modules } = await getAppSettings();
  if (!modules.maintenance) redirect("/dashboard");

  const jobId = String(fd.get("jobId") ?? "").trim();
  if (!jobId) redirect("/maintenance");

  const stageRaw = String(fd.get("stage") ?? "").trim();
  const note = stageRaw === "before" ? "Before" : stageRaw === "after" ? "After" : "Photo";
  const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);

  let qs = "";
  if (files.length > 0) {
    const res = await saveMaintenancePhotos({
      files,
      maintenanceJobId: jobId,
      note,
      uploadType: "other",
      actor: await auditActor(),
    });
    qs = res.saved > 0
      ? `?photo_msg=${encodeURIComponent(`${res.saved} photo${res.saved === 1 ? "" : "s"} added.`)}`
      : res.storageError
        ? `?error=${encodeURIComponent("File storage isn't configured — photos can't be saved.")}`
        : `?error=${encodeURIComponent("No valid images — use JPG/PNG/WebP under 10 MB.")}`;
  }
  redirect(`/maintenance/${jobId}${qs}`);
}
