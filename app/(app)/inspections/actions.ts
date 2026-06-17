"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import { toCents } from "@/lib/money";
import { parseInspectionType } from "@/lib/inspections/disposition";
import {
  addDeduction,
  cancelInspection,
  completeInspection,
  createInspection,
  removeDeduction,
} from "@/lib/services/inspections";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

async function gate(): Promise<void> {
  await requireCapability("inspections.manage");
  await assertModuleEnabled("inspections");
}

export async function createInspectionAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await gate();
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
  await gate();
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
  await gate();
  const id = String(fd.get("inspectionId") ?? "").trim();
  if (!id) throw new Error("Missing inspection id.");
  await cancelInspection({ id, actor: await auditActor() });
  revalidatePath("/inspections");
  revalidatePath(`/inspections/${id}`);
}

export async function addDeductionAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await gate();
  const inspectionId = str(fd, "inspectionId");
  if (!inspectionId) return { error: "Missing inspection id." };
  const label = str(fd, "label");
  if (!label) return { error: "Describe the deduction." };

  let amountCents: bigint;
  try {
    amountCents = toCents(str(fd, "amount"));
  } catch {
    return { error: "Enter a valid amount." };
  }
  if (amountCents <= 0n) return { error: "Amount must be greater than zero." };

  const res = await addDeduction({
    inspectionId,
    label,
    amountCents,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not add deduction." };
  revalidatePath(`/inspections/${inspectionId}`);
  return { ok: true };
}

export async function removeDeductionAction(fd: FormData): Promise<void> {
  await gate();
  const itemId = String(fd.get("itemId") ?? "").trim();
  const inspectionId = String(fd.get("inspectionId") ?? "").trim();
  if (!itemId) throw new Error("Missing item id.");
  await removeDeduction({ itemId, actor: await auditActor() });
  if (inspectionId) revalidatePath(`/inspections/${inspectionId}`);
}
