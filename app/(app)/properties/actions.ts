"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/services/app-settings";
import { toCents } from "@/lib/money";
import { requireCapability, auditActor } from "@/lib/auth/session";
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
  await requireCapability("properties.manage");
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
  await requireCapability("properties.manage");
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
  await requireCapability("properties.manage");
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
  await requireCapability("properties.manage");
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
  const internetFeeCents = internetFeeRaw
    ? toCents(internetFeeRaw)
    : (await getAppSettings()).billing.internetFeeCents;
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

export async function updateProperty(fd: FormData): Promise<void> {
  await requireCapability("properties.manage");
  const propertyId = str(fd, "propertyId");
  const name = str(fd, "name");
  if (!propertyId || !name) throw new Error("Property name is required.");
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error("Property not found.");

  const timezone = str(fd, "timezone") || property.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`Unknown IANA timezone: ${timezone}`);
  }
  // An invalid ISO-4217 code would make formatCurrency throw on every page
  // that renders money for this property — validate like the timezone.
  const currency = (str(fd, "currency") || property.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error(`Currency must be a 3-letter ISO 4217 code, got: ${currency}`);
  }
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    throw new Error(`Unknown ISO 4217 currency code: ${currency}`);
  }

  // Financing (Financials module): monthly mortgage payment + maturity date.
  const mortgageRaw = str(fd, "monthlyMortgage");
  let monthlyMortgageCents: bigint | null = null;
  if (mortgageRaw) {
    monthlyMortgageCents = toCents(mortgageRaw);
    if (monthlyMortgageCents < 0n) throw new Error("Mortgage cannot be negative.");
    if (monthlyMortgageCents === 0n) monthlyMortgageCents = null;
  }
  const maturityRaw = str(fd, "mortgageMaturityDate");
  const mortgageMaturityDate = maturityRaw
    ? parseDateOnlyInZone(maturityRaw, timezone)
    : null;
  if (maturityRaw && !mortgageMaturityDate) {
    throw new Error("Mortgage maturity date must be a valid date (YYYY-MM-DD).");
  }

  const data = {
    name,
    addressLine1: str(fd, "addressLine1") || null,
    addressLine2: str(fd, "addressLine2") || null,
    city: str(fd, "city") || null,
    state: str(fd, "state") || null,
    zip: str(fd, "zip") || null,
    notes: str(fd, "notes") || null,
    timezone,
    currency,
    monthlyMortgageCents,
    mortgageMaturityDate,
    isActive: fd.get("isActive") === "on",
  };

  await withAudit(
    {
      ...(await auditActor()),
      action: "property.updated",
      entityType: "Property",
      entityId: property.id,
      before: {
        name: property.name,
        addressLine1: property.addressLine1,
        addressLine2: property.addressLine2,
        city: property.city,
        state: property.state,
        zip: property.zip,
        notes: property.notes,
        timezone: property.timezone,
        currency: property.currency,
        monthlyMortgageCents: property.monthlyMortgageCents,
        mortgageMaturityDate: property.mortgageMaturityDate,
        isActive: property.isActive,
      },
    },
    async (tx) => {
      const updated = await tx.property.update({
        where: { id: property.id },
        data,
      });
      return { result: updated, after: data };
    },
  );

  revalidatePath(`/properties/${property.id}`);
  revalidatePath("/properties");
  revalidatePath("/financials");
}

export async function setPropertyActive(
  propertyId: string,
  isActive: boolean,
): Promise<void> {
  await requireCapability("properties.manage");
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
