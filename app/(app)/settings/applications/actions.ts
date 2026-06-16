"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import {
  saveApplicationCustomSections,
  saveApplicationFields,
} from "@/lib/services/app-settings";
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

/**
 * Save the operator-defined custom question sections. The builder serializes
 * its state into a `sectionsJson` field; the service re-sanitizes it (clamps
 * counts/lengths, drops malformed entries) before persisting.
 */
export async function saveCustomSectionsAction(
  _prev: ApplicationSettingsState,
  fd: FormData,
): Promise<ApplicationSettingsState> {
  await requireCapability("applications.manage");

  let parsed: unknown = [];
  const raw = String(fd.get("sectionsJson") ?? "");
  if (raw.trim() !== "") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { error: "Couldn't read the questions — please try again." };
    }
  }

  try {
    await saveApplicationCustomSections(parsed, await auditActor());
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to save." };
  }
  revalidatePath("/settings/applications");
  revalidatePath("/apply");
  return { ok: true, message: "Custom questions updated." };
}
