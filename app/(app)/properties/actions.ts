"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { toCents } from "@/lib/money";
import { requireRole, auditActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit/audit";
import type {
  OccupancyStatus,
  UnitType,
} from "@/lib/generated/prisma/enums";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function createProperty(fd: FormData): Promise<void> {
  await requireRole("manager");
  const env = getEnv();
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
      timezone: str(fd, "timezone") || env.DEFAULT_TIMEZONE,
      currency: str(fd, "currency") || env.DEFAULT_CURRENCY,
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
  const building = await prisma.building.create({
    data: {
      propertyId,
      name,
      description: str(fd, "description") || null,
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

export async function createUnit(fd: FormData): Promise<void> {
  await requireRole("manager");
  const propertyId = str(fd, "propertyId");
  const buildingId = str(fd, "buildingId") || null;
  const unitNumber = str(fd, "unitNumber");
  if (!propertyId || !unitNumber) throw new Error("Unit number is required.");
  const rent = str(fd, "defaultRent");
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
