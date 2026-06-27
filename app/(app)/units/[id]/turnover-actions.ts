"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireModuleCapability } from "@/lib/auth/session";
import { getFormString as str, type FormState } from "@/lib/forms";
import { parseTurnoverStatus } from "@/lib/maintenance/turnover-status";
import {
  addTurnoverItem,
  createTurnoverChecklist,
  deleteTurnoverChecklist,
  deleteTurnoverItem,
  setTurnoverStatus,
  toggleTurnoverItemDone,
  updateTurnoverItem,
} from "@/lib/services/turnover";

/**
 * Server actions for the unit turnover / make-ready checklist. Every mutation is
 * gated with the EXISTING maintenance capability (maintenance.manage) + the
 * maintenance module, and audited in-transaction inside the service via
 * withAudit. Validation errors are returned as FormState (rendered inline by the
 * FormDialog) rather than thrown. Operating records only — never touch balances.
 */

/** The unit page (where the checklist is surfaced) needs revalidating. */
function revalidateUnit(unitId: string): void {
  revalidatePath(`/units/${unitId}`);
}

export async function createTurnoverChecklistAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const unitId = str(fd, "unitId");
  if (!unitId) return { error: "Missing unit." };
  const res = await createTurnoverChecklist({
    unitId,
    leaseId: str(fd, "leaseId") || null,
    title: str(fd, "title") || null,
    actor: await auditActor(),
  });
  if ("error" in res) return { error: res.error };
  revalidateUnit(unitId);
  return { ok: true };
}

export async function addTurnoverItemAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const unitId = str(fd, "unitId");
  const res = await addTurnoverItem({
    checklistId: str(fd, "checklistId"),
    label: str(fd, "label"),
    area: str(fd, "area") || null,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not add item." };
  if (unitId) revalidateUnit(unitId);
  return { ok: true };
}

export async function updateTurnoverItemAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const unitId = str(fd, "unitId");
  const res = await updateTurnoverItem({
    itemId: str(fd, "itemId"),
    label: str(fd, "label"),
    area: str(fd, "area") || null,
    notes: str(fd, "notes") || null,
    assignedToUserId: str(fd, "assignedToUserId") || null,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not update item." };
  if (unitId) revalidateUnit(unitId);
  return { ok: true };
}

/** Plain-form toggle (row checkbox button). Reads desired state from `done`. */
export async function toggleTurnoverItemDoneAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const unitId = str(fd, "unitId");
  await toggleTurnoverItemDone({
    itemId: str(fd, "itemId"),
    done: str(fd, "done") === "true",
    actor: await auditActor(),
  });
  if (unitId) revalidateUnit(unitId);
}

export async function deleteTurnoverItemAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const unitId = str(fd, "unitId");
  await deleteTurnoverItem({
    itemId: str(fd, "itemId"),
    actor: await auditActor(),
  });
  if (unitId) revalidateUnit(unitId);
}

export async function setTurnoverStatusAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const unitId = str(fd, "unitId");
  const status = parseTurnoverStatus(str(fd, "status"));
  if (!status) return { error: "Pick a valid status." };
  const res = await setTurnoverStatus({
    checklistId: str(fd, "checklistId"),
    status,
    actor: await auditActor(),
  });
  if (!res.ok) return { error: res.error ?? "Could not update status." };
  if (unitId) revalidateUnit(unitId);
  return { ok: true };
}

export async function deleteTurnoverChecklistAction(
  fd: FormData,
): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const unitId = str(fd, "unitId");
  await deleteTurnoverChecklist({
    checklistId: str(fd, "checklistId"),
    actor: await auditActor(),
  });
  if (unitId) revalidateUnit(unitId);
}
