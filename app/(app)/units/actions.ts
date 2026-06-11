"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { requireRole, auditActor } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import type {
  OccupancyStatus,
  UnitType,
} from "@/lib/generated/prisma/enums";

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

export async function updateUnit(fd: FormData): Promise<void> {
  await requireRole("manager");
  const unitId = str(fd, "unitId");
  const unitNumber = str(fd, "unitNumber");
  if (!unitId || !unitNumber) throw new Error("Unit number is required.");

  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) throw new Error("Unit not found.");

  const buildingId = str(fd, "buildingId") || null;
  if (buildingId) {
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building || building.propertyId !== unit.propertyId) {
      throw new Error("Building does not belong to this property.");
    }
  }

  const internetEnabled = fd.get("internetEnabled") === "on";
  const internetFeeRaw = str(fd, "internetFee");
  if (!internetFeeRaw) throw new Error("Internet fee is required (enter 0 for none).");
  const internetFeeCents = toCents(internetFeeRaw);
  if (internetFeeCents < 0n) throw new Error("Internet fee cannot be negative.");

  const rentRaw = str(fd, "defaultRent");
  if (!rentRaw) throw new Error("Default rent is required (enter 0 for none).");
  const data = {
    unitNumber,
    buildingId,
    unitType: (str(fd, "unitType") || "apartment") as UnitType,
    occupancyStatus: (str(fd, "occupancyStatus") || "vacant") as OccupancyStatus,
    bedrooms: numOrNull(fd, "bedrooms", { integer: true, label: "Bedrooms" }),
    bathrooms: numOrNull(fd, "bathrooms", { label: "Bathrooms" }),
    squareFeet: numOrNull(fd, "squareFeet", { integer: true, label: "Square feet" }),
    defaultRentAmountCents: toCents(rentRaw),
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
        occupancyStatus: unit.occupancyStatus,
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
          occupancyStatus: updated.occupancyStatus,
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
}

export async function deleteUnit(fd: FormData): Promise<void> {
  await requireRole("manager");
  const unitId = str(fd, "unitId");
  if (!unitId) throw new Error("Missing unit id.");

  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: { _count: { select: { leases: true } } },
  });
  if (!unit) throw new Error("Unit not found.");
  if (unit._count.leases > 0) {
    throw new Error(
      "This unit has lease history and cannot be deleted. Set its occupancy to 'unavailable' instead.",
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
