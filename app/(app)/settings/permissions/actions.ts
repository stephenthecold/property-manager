"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { saveRolePermissions } from "@/lib/services/app-settings";
import {
  CAPABILITIES,
  diffFromDefault,
  EDITABLE_ROLES,
  isLocked,
} from "@/lib/auth/permissions";

/**
 * Persist the role→capability matrix. Unchecked checkboxes don't post, so we
 * reconstruct the full editable grid server-side (presence === granted) and let
 * diffFromDefault drop locked/owner/default-equal entries before saving.
 */
export async function savePermissionsAction(fd: FormData): Promise<void> {
  await requireCapability("users.manage");

  const full: Record<string, Record<string, boolean>> = {};
  for (const role of EDITABLE_ROLES) {
    full[role] = {};
    for (const cap of CAPABILITIES) {
      if (isLocked(role, cap)) continue;
      full[role][cap] = fd.get(`perm:${role}:${cap}`) === "on";
    }
  }

  await saveRolePermissions(
    diffFromDefault(full as Parameters<typeof diffFromDefault>[0]),
    await auditActor(),
  );
  revalidatePath("/settings/permissions");
}
