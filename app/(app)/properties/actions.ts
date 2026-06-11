"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/services/app-settings";
import { toCents } from "@/lib/money";
import { requireRole, auditActor } from "@/lib/auth/session";
import { writeAudit, withAudit } from "@/lib/audit/audit";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type {
  OccupancyStatus,
  UnitType,
} from "@/lib/generated/prisma/enums";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function createProperty(fd: FormData): Promise<void> {
  await requireRole("manager");
  // DB-configured org defaults win over env (Settings -> Organization).
  const app = await getAppSettings();
  const name = str(fd, "name");
  if (!name) throw new Error("Property name is required.");
  const property = await prisma.property.create({
    data: {
      name,
      addressLine1: str(fd, "addressLine1") || null,
      city: str(fd, "city") || null,
      state: str(fd, "state") || null,
      zip: str(fd, "zip") || null,
      notes: str(fd, "notes") || null,
      timezone: str(fd, "timezone") || app.defaultTimezone,
      currency: str(fd, "currency") || app.defaultCurrency,
    },
  });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "property.created",
    entityType: "Property",
    entityId: property.id,
    after: { name },
  });
  redirect(`/properties/${property.id}`);
}

export async function createBuilding(fd: FormData): Promise<void> {
  await requireRole("manager");
  const propertyId = str(fd, "propertyId");
  const name = str(fd, "name");
  if (!propertyId || !name) throw new Error("Building name is required.");
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error("Property not found.");
  const purchaseRaw = str(fd, "purchaseDate");
  const purchaseDate = purchaseRaw
    ? parseDateOnlyInZone(purchaseRaw, property.timezone)
    : null;
  if (purchaseRaw && !purchaseDate) {
    throw new Error("Purchase date must be a valid date (YYYY-MM-DD).");
  }
  const building = await prisma.building.create({
    data: {
      propertyId,
      name,
      description: str(fd, "description") || null,
      purchaseDate,
    },
  });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "building.created",
    entityType: "Building",
    entityId: building.id,
    after: { name, propertyId },
  });
  revalidatePath(`/properties/${propertyId}`);
}

export async function updateBuilding(fd: FormData): Promise<void> {
  await requireRole("manager");
  const buildingId = str(fd, "buildingId");
  const name = str(fd, "name");
  if (!buildingId || !name) throw new Error("Building name is required.");
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    include: { property: true },
  });
  if (!building) throw new Error("Building not found.");

  const purchaseRaw = str(fd, "purchaseDate");
  const purchaseDate = purchaseRaw
    ? parseDateOnlyInZone(purchaseRaw, building.property.timezone)
    : null;
  if (purchaseRaw && !purchaseDate) {
    throw new Error("Purchase date must be a valid date (YYYY-MM-DD).");
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "building.updated",
      entityType: "Building",
      entityId: building.id,
      before: {
        name: building.name,
        description: building.description,
        purchaseDate: building.purchaseDate,
        notes: building.notes,
      },
    },
    async (tx) => {
      const updated = await tx.building.update({
        where: { id: building.id },
        data: {
          name,
          description: str(fd, "description") || null,
          notes: str(fd, "notes") || null,
          purchaseDate,
        },
      });
      return {
        result: updated,
        after: {
          name: updated.name,
          description: updated.description,
          purchaseDate: updated.purchaseDate,
          notes: updated.notes,
        },
      };
    },
  );

  revalidatePath(`/properties/${building.propertyId}`);
  revalidatePath(`/buildings/${building.id}`);
}

export async function createUnit(fd: FormData): Promise<void> {
  await requireRole("manager");
  const propertyId = str(fd, "propertyId");
  const buildingId = str(fd, "buildingId") || null;
  const unitNumber = str(fd, "unitNumber");
  if (!propertyId || !unitNumber) throw new Error("Unit number is required.");
  if (buildingId) {
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building || building.propertyId !== propertyId) {
      throw new Error("Building does not belong to this property.");
    }
  }
  const rent = str(fd, "defaultRent");
  const internetFeeRaw = str(fd, "internetFee");
  const internetFeeCents = internetFeeRaw ? toCents(internetFeeRaw) : 2500n;
  if (internetFeeCents < 0n) throw new Error("Internet fee cannot be negative.");
  const unit = await prisma.unit.create({
    data: {
      propertyId,
      buildingId,
      unitNumber,
      unitType: (str(fd, "unitType") || "apartment") as UnitType,
      bedrooms: fd.get("bedrooms") ? Number(fd.get("bedrooms")) : null,
      bathrooms: fd.get("bathrooms") ? Number(fd.get("bathrooms")) : null,
      defaultRentAmountCents: rent ? toCents(rent) : 0n,
      occupancyStatus: (str(fd, "occupancyStatus") || "vacant") as OccupancyStatus,
      internetEnabled: fd.get("internetEnabled") === "on",
      internetFeeCents,
    },
  });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "unit.created",
    entityType: "Unit",
    entityId: unit.id,
    after: { unitNumber, propertyId },
  });
  revalidatePath(`/properties/${propertyId}`);
}

export async function setPropertyActive(
  propertyId: string,
  isActive: boolean,
): Promise<void> {
  await requireRole("manager");
  await prisma.property.update({ where: { id: propertyId }, data: { isActive } });
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "property.archived",
    entityType: "Property",
    entityId: propertyId,
    after: { isActive },
  });
  revalidatePath("/properties");
}
