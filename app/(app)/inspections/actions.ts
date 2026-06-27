"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auditActor, requireModuleCapability } from "@/lib/auth/session";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import { toCents } from "@/lib/money";
import { parseInspectionType } from "@/lib/inspections/disposition";
import { parseChecklistStatus } from "@/lib/inspections/checklist";
import {
  addChecklistItem,
  addChecklistItemPhotos,
  cancelInspection,
  completeInspection,
  createInspection,
  deleteChecklistItemPhoto,
  removeChecklistItem,
  updateChecklistItem,
} from "@/lib/services/inspections";
import { getFormString as str, type FormState } from "@/lib/forms";

export async function createInspectionAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("inspections.manage", "inspections");
  const leaseId = str(fd, "leaseId");
  if (!leaseId) return { error: "Pick a lease." };
  const type = parseInspectionType(str(fd, "type"));

  let scheduledFor: Date | null = null;
  const raw = str(fd, "scheduledFor");
  if (raw) {
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      select: { unit: { select: { property: { select: { timezone: true } } } } },
    });
    if (!lease) return { error: "Lease not found." };
    scheduledFor = parseDateOnlyInZone(raw, lease.unit.property.timezone);
    if (!scheduledFor) return { error: "Invalid scheduled date." };
  }

  const res = await createInspection({
    leaseId,
    type,
    scheduledFor,
    inspector: str(fd, "inspector") || null,
    templateId: str(fd, "templateId") || null,
    actor: await auditActor(),
  });
  if ("error" in res) return { error: res.error };
  revalidatePath("/inspections");
  return { ok: true };
}

export async function completeInspectionAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("inspections.manage", "inspections");
  const id = str(fd, "inspectionId");
  if (!id) return { error: "Missing inspection id." };
  const res = await completeInspection({
    id,
    summary: str(fd, "summary") || null,
    completedAt: new Date(),
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not complete." };
  revalidatePath("/inspections");
  revalidatePath(`/inspections/${id}`);
  return { ok: true };
}

export async function cancelInspectionAction(fd: FormData): Promise<void> {
  await requireModuleCapability("inspections.manage", "inspections");
  const id = String(fd.get("inspectionId") ?? "").trim();
  if (!id) throw new Error("Missing inspection id.");
  await cancelInspection({ id, actor: await auditActor() });
  revalidatePath("/inspections");
  revalidatePath(`/inspections/${id}`);
}

// --- Condition CHECKLIST items + photos -----------------------------------

/**
 * Parse an optional move-out deduction amount on a checklist item. Blank → 0
 * (clears it); a negative or unparseable value → null (a validation error).
 */
function parseAmount(raw: string): bigint | null {
  if (!raw.trim()) return 0n;
  try {
    const c = toCents(raw);
    return c < 0n ? null : c;
  } catch {
    return null;
  }
}

export async function addChecklistItemAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("inspections.manage", "inspections");
  const inspectionId = str(fd, "inspectionId");
  if (!inspectionId) return { error: "Missing inspection id." };
  const label = str(fd, "label");
  if (!label) return { error: "Describe what to check." };

  // Only touch the deduction when the form actually carried the field (move-out);
  // otherwise leave it to the service default. Blank-but-present means "clear".
  let amountCents: bigint | undefined;
  if (fd.has("amount")) {
    const parsed = parseAmount(str(fd, "amount"));
    if (parsed === null) return { error: "Enter a valid deduction amount." };
    amountCents = parsed;
  }

  const res = await addChecklistItem({
    inspectionId,
    label,
    area: str(fd, "area") || null,
    category: str(fd, "category") || null,
    amountCents,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not add item." };
  revalidatePath(`/inspections/${inspectionId}`);
  return { ok: true };
}

export async function updateChecklistItemAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("inspections.manage", "inspections");
  const itemId = str(fd, "itemId");
  const inspectionId = str(fd, "inspectionId");
  if (!itemId) return { error: "Missing item id." };

  // Only touch the deduction when the form carried the field (move-out edit);
  // a status/note-only edit omits it and the service preserves the prior amount.
  let amountCents: bigint | undefined;
  if (fd.has("amount")) {
    const parsed = parseAmount(str(fd, "amount"));
    if (parsed === null) return { error: "Enter a valid deduction amount." };
    amountCents = parsed;
  }

  const res = await updateChecklistItem({
    itemId,
    status: parseChecklistStatus(str(fd, "status")),
    note: str(fd, "note") || null,
    amountCents,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not update item." };
  if (inspectionId) revalidatePath(`/inspections/${inspectionId}`);
  return { ok: true };
}

export async function removeChecklistItemAction(fd: FormData): Promise<void> {
  await requireModuleCapability("inspections.manage", "inspections");
  const itemId = String(fd.get("itemId") ?? "").trim();
  const inspectionId = String(fd.get("inspectionId") ?? "").trim();
  if (!itemId) throw new Error("Missing item id.");
  await removeChecklistItem({ itemId, actor: await auditActor() });
  if (inspectionId) revalidatePath(`/inspections/${inspectionId}`);
}

export async function addChecklistPhotosAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("inspections.manage", "inspections");
  const itemId = str(fd, "itemId");
  const inspectionId = str(fd, "inspectionId");
  if (!itemId || !inspectionId) return { error: "Missing item id." };

  const files = fd
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const res = await addChecklistItemPhotos({
    itemId,
    inspectionId,
    files,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not save photos." };
  revalidatePath(`/inspections/${inspectionId}`);
  return { ok: true };
}

export async function deleteChecklistPhotoAction(fd: FormData): Promise<void> {
  await requireModuleCapability("inspections.manage", "inspections");
  const photoId = String(fd.get("photoId") ?? "").trim();
  const inspectionId = String(fd.get("inspectionId") ?? "").trim();
  if (!photoId || !inspectionId) throw new Error("Missing photo id.");
  await deleteChecklistItemPhoto({ photoId, inspectionId, actor: await auditActor() });
  revalidatePath(`/inspections/${inspectionId}`);
}
