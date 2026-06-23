"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { requireCapability, auditActor } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import {
  createConditionLog,
  deleteConditionLog,
  isConditionPhase,
} from "@/lib/services/unit-condition";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type {
  ServiceStatus,
  UnitType,
} from "@/lib/generated/prisma/enums";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function numOrNull(
  fd: FormData,
  key: string,
  opts: { integer?: boolean; label: string },
): number | null {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) throw new Error(`${opts.label} must be a number.`);
  if (opts.integer && !Number.isInteger(n)) {
    throw new Error(`${opts.label} must be a whole number.`);
  }
  return n;
}

export async function updateUnit(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("properties.manage");
  const unitId = str(fd, "unitId");
  const unitNumber = str(fd, "unitNumber");
  if (!unitId || !unitNumber) return { error: "Unit number is required." };

  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { property: { select: { timezone: true } } },
  });
  if (!unit) return { error: "Unit not found." };

  const availableRaw = str(fd, "availableFromDate");
  const availableFromDate = availableRaw
    ? parseDateOnlyInZone(availableRaw, unit.property.timezone)
    : null;
  if (availableRaw && !availableFromDate) {
    return { error: "Available-from date must be a valid date." };
  }

  const buildingId = str(fd, "buildingId") || null;
  if (buildingId) {
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building || building.propertyId !== unit.propertyId) {
      return { error: "Building does not belong to this property." };
    }
  }

  const internetEnabled = fd.get("internetEnabled") === "on";
  const internetFeeRaw = str(fd, "internetFee");
  if (!internetFeeRaw) {
    return { error: "Internet fee is required (enter 0 for none)." };
  }
  const rentRaw = str(fd, "defaultRent");
  if (!rentRaw) return { error: "Default rent is required (enter 0 for none)." };

  // numOrNull and toCents throw on malformed input — surface the message inline
  // rather than letting it become the opaque error page.
  let internetFeeCents: bigint;
  let defaultRentAmountCents: bigint;
  let bedrooms: number | null;
  let bathrooms: number | null;
  let squareFeet: number | null;
  try {
    internetFeeCents = toCents(internetFeeRaw);
    defaultRentAmountCents = toCents(rentRaw);
    bedrooms = numOrNull(fd, "bedrooms", { integer: true, label: "Bedrooms" });
    bathrooms = numOrNull(fd, "bathrooms", { label: "Bathrooms" });
    squareFeet = numOrNull(fd, "squareFeet", { integer: true, label: "Square feet" });
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Check the rent and unit detail fields.",
    };
  }
  if (internetFeeCents < 0n) {
    return { error: "Internet fee cannot be negative." };
  }
  const data = {
    unitNumber,
    buildingId,
    unitType: (str(fd, "unitType") || "apartment") as UnitType,
    serviceStatus: (str(fd, "serviceStatus") || "in_service") as ServiceStatus,
    availableFromDate,
    bedrooms,
    bathrooms,
    squareFeet,
    defaultRentAmountCents,
    internetEnabled,
    internetFeeCents,
    notes: str(fd, "notes") || null,
  };

  await withAudit(
    {
      ...(await auditActor()),
      action: "unit.updated",
      entityType: "Unit",
      entityId: unit.id,
      before: {
        unitNumber: unit.unitNumber,
        buildingId: unit.buildingId,
        unitType: unit.unitType,
        serviceStatus: unit.serviceStatus,
        availableFromDate: unit.availableFromDate,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        squareFeet: unit.squareFeet,
        defaultRentAmountCents: unit.defaultRentAmountCents,
        internetEnabled: unit.internetEnabled,
        internetFeeCents: unit.internetFeeCents,
        notes: unit.notes,
      },
    },
    async (tx) => {
      const updated = await tx.unit.update({ where: { id: unit.id }, data });
      return {
        result: updated,
        after: {
          unitNumber: updated.unitNumber,
          buildingId: updated.buildingId,
          unitType: updated.unitType,
          serviceStatus: updated.serviceStatus,
          availableFromDate: updated.availableFromDate,
          bedrooms: updated.bedrooms,
          bathrooms: updated.bathrooms,
          squareFeet: updated.squareFeet,
          defaultRentAmountCents: updated.defaultRentAmountCents,
          internetEnabled: updated.internetEnabled,
          internetFeeCents: updated.internetFeeCents,
          notes: updated.notes,
        },
      };
    },
  );

  revalidatePath(`/units/${unit.id}`);
  revalidatePath(`/properties/${unit.propertyId}`);
  return { ok: true };
}

export async function deleteUnit(fd: FormData): Promise<void> {
  await requireCapability("properties.manage");
  const unitId = str(fd, "unitId");
  if (!unitId) throw new Error("Missing unit id.");

  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { _count: { select: { leases: true } } },
  });
  if (!unit) throw new Error("Unit not found.");
  if (unit._count.leases > 0) {
    throw new Error(
      "This unit has lease history and cannot be deleted. Set its service status to 'unavailable' instead.",
    );
  }

  // Hard delete is unrecoverable — snapshot the full scalar row in the audit.
  const { _count, ...unitSnapshot } = unit;
  await withAudit(
    {
      ...(await auditActor()),
      action: "unit.deleted",
      entityType: "Unit",
      entityId: unit.id,
      before: unitSnapshot,
    },
    async (tx) => {
      await tx.unit.delete({ where: { id: unit.id } });
      return { result: undefined };
    },
  );

  revalidatePath(`/properties/${unit.propertyId}`);
  redirect(`/properties/${unit.propertyId}`);
}

/**
 * Add a dated unit condition photo batch (module "inspections"). Documents
 * move-in / move-out / turnover condition with a note + photos. Returns inline
 * errors for the FormDialog; never touches the ledger or deposit disposition.
 */
export async function addUnitConditionAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("inspections.manage");
  await assertModuleEnabled("inspections");

  const unitId = str(fd, "unitId");
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { property: { select: { timezone: true } } },
  });
  if (!unit) return { error: "Unit not found." };

  const phaseRaw = str(fd, "phase");
  if (!isConditionPhase(phaseRaw)) {
    return { error: "Choose move-in, move-out, turnover, or other." };
  }

  const dateRaw = str(fd, "conditionDate");
  const conditionDate = dateRaw
    ? parseDateOnlyInZone(dateRaw, unit.property.timezone)
    : new Date();
  if (dateRaw && !conditionDate) {
    return { error: "Condition date must be a valid date." };
  }

  const files = fd
    .getAll("photos")
    .filter((f): f is File => f instanceof File && f.size > 0);

  const res = await createConditionLog({
    unitId,
    leaseId: str(fd, "leaseId") || null,
    phase: phaseRaw,
    conditionDate: conditionDate!,
    note: str(fd, "note") || null,
    files,
    actor: await auditActor(),
  });
  if ("error" in res) return { error: res.error };

  revalidatePath(`/units/${unitId}`);
  return { ok: true };
}

/** Delete a unit condition batch (and its photos). */
export async function deleteUnitConditionAction(fd: FormData): Promise<void> {
  await requireCapability("inspections.manage");
  await assertModuleEnabled("inspections");
  const logId = str(fd, "logId");
  const unitId = str(fd, "unitId");
  if (logId) await deleteConditionLog(logId, await auditActor());
  if (unitId) revalidatePath(`/units/${unitId}`);
}
