"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { saveApplicationFields } from "@/lib/services/app-settings";
import {
  APPLICATION_FIELDS,
  type ApplicationFormConfig,
  type FieldMode,
} from "@/lib/applications/form-config";

export interface ApplicationSettingsState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export async function saveApplicationFieldsAction(
  _prev: ApplicationSettingsState,
  fd: FormData,
): Promise<ApplicationSettingsState> {
  await requireCapability("applications.manage");

  const config: ApplicationFormConfig = {};
  for (const f of APPLICATION_FIELDS) {
    const raw = String(fd.get(`field_${f.key}`) ?? "");
    config[f.key] = (["hidden", "optional", "required"].includes(raw)
      ? raw
      : "optional") as FieldMode;
  }

  try {
    await saveApplicationFields(config, await auditActor());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save." };
  }
  revalidatePath("/settings/applications");
  revalidatePath("/apply");
  return { ok: true, message: "Application form updated." };
}
