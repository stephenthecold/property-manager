"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { saveModules } from "@/lib/services/app-settings";

export async function saveModulesAction(fd: FormData): Promise<void> {
  await requireCapability("organization.settings");
  await saveModules(
    {
      financials: fd.get("financials") === "on",
      maintenance: fd.get("maintenance") === "on",
      tenantPortal: fd.get("tenantPortal") === "on",
    },
    await auditActor(),
  );
  // Module flags shape the nav and dashboard everywhere.
  revalidatePath("/", "layout");
}
