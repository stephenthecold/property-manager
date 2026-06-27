"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireModuleCapability } from "@/lib/auth/session";
import { isInspectionType, parseInspectionType } from "@/lib/inspections/disposition";
import {
  createInspectionTemplate,
  deleteInspectionTemplate,
  parseTemplateItems,
  setInspectionTemplateActive,
  updateInspectionTemplate,
} from "@/lib/services/inspection-templates";
import type { InspectionType } from "@/lib/generated/prisma/enums";
import { getFormString as str, type FormState } from "@/lib/forms";

/** Optional default type: blank = "any", else a valid InspectionType. */
function readType(fd: FormData): InspectionType | null {
  const raw = str(fd, "type");
  if (!raw) return null;
  return isInspectionType(raw) ? parseInspectionType(raw) : null;
}

export async function createTemplateAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("inspections.manage", "inspections");
  const name = str(fd, "name");
  if (!name) return { error: "Name the template." };

  const res = await createInspectionTemplate({
    name,
    type: readType(fd),
    description: str(fd, "description") || null,
    items: parseTemplateItems(str(fd, "items")),
    actor: await auditActor(),
  });
  if ("error" in res) return { error: res.error };
  revalidatePath("/settings/inspection-templates");
  return { ok: true };
}

export async function updateTemplateAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("inspections.manage", "inspections");
  const id = str(fd, "templateId");
  if (!id) return { error: "Missing template id." };
  const name = str(fd, "name");
  if (!name) return { error: "Name the template." };

  const res = await updateInspectionTemplate({
    id,
    name,
    type: readType(fd),
    description: str(fd, "description") || null,
    items: parseTemplateItems(str(fd, "items")),
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Update failed." };
  revalidatePath("/settings/inspection-templates");
  return { ok: true };
}

export async function setTemplateActiveAction(fd: FormData): Promise<void> {
  await requireModuleCapability("inspections.manage", "inspections");
  const id = String(fd.get("templateId") ?? "").trim();
  if (!id) throw new Error("Missing template id.");
  const isActive = String(fd.get("isActive") ?? "") === "true";
  await setInspectionTemplateActive({ id, isActive, actor: await auditActor() });
  revalidatePath("/settings/inspection-templates");
}

export async function deleteTemplateAction(fd: FormData): Promise<void> {
  await requireModuleCapability("inspections.manage", "inspections");
  const id = String(fd.get("templateId") ?? "").trim();
  if (!id) throw new Error("Missing template id.");
  await deleteInspectionTemplate({ id, actor: await auditActor() });
  revalidatePath("/settings/inspection-templates");
}
