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
  ServiceStatus,
  UnitType,
} from "@/lib/generated/prisma/enums";
import type { FormState } from "@/lib/forms";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

/** "" → null; a non-numeric entry → the "invalid" sentinel (caller errors). */
function numOrNull(fd: FormData, key: string): number | null | "invalid" {
  const v = str(fd, key);
  if (!v) return null;
  const n = Number(v.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : "invalid";
}

export async function createProperty(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("properties.manage");
  // DB-configured org defaults win over env (Settings -> Organization).
  const app = await getAppSettings();
  const name = str(fd, "name");
  if (!name) return { error: "Property name is required." };
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

export async function createBuilding(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("properties.manage");
  const propertyId = str(fd, "propertyId");
  const name = str(fd, "name");
  if (!propertyId || !name) return { error: "Building name is required." };
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return { error: "Property not found." };
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
  return { ok: true };
}

export async function updateBuilding(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("properties.manage");
  const buildingId = str(fd, "buildingId");
  const name = str(fd, "name");
  if (!buildingId || !name) return { error: "Building name is required." };
  const building = await prisma.building.findUnique({
    where: { id: buildingId },
    include: { property: true },
  });
  if (!building) return { error: "Building not found." };

  await withAudit(
    {
      ...(await auditActor()),
      action: "building.updated",
      entityType: "Building",
      entityId: building.id,
      before: {
        name: building.name,
        description: building.description,
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
        },
      });
      return {
        result: updated,
        after: {
          name: updated.name,
          description: updated.description,
          notes: updated.notes,
        },
      };
    },
  );


  revalidatePath(`/properties/${building.propertyId}`);
  revalidatePath(`/buildings/${building.id}`);
  return { ok: true };
}

export async function createUnit(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("properties.manage");
  const propertyId = str(fd, "propertyId");
  const buildingId = str(fd, "buildingId") || null;
  const unitNumber = str(fd, "unitNumber");
  if (!propertyId || !unitNumber) return { error: "Unit number is required." };
  if (buildingId) {
    const building = await prisma.building.findUnique({ where: { id: buildingId } });
    if (!building || building.propertyId !== propertyId) {
      return { error: "Building does not belong to this property." };
    }
  }
  const rent = str(fd, "defaultRent");
  const internetFeeRaw = str(fd, "internetFee");
  let internetFeeCents: bigint;
  let defaultRentAmountCents: bigint;
  try {
    internetFeeCents = internetFeeRaw
      ? toCents(internetFeeRaw)
      : (await getAppSettings()).billing.internetFeeCents;
    defaultRentAmountCents = rent ? toCents(rent) : 0n;
  } catch {
    return { error: "Rent and internet fee must be valid amounts (e.g. 1200.00)." };
  }
  if (internetFeeCents < 0n) return { error: "Internet fee cannot be negative." };
  const bedrooms = numOrNull(fd, "bedrooms");
  if (bedrooms === "invalid") return { error: "Bedrooms must be a number." };
  const bathrooms = numOrNull(fd, "bathrooms");
  if (bathrooms === "invalid") return { error: "Bathrooms must be a number." };
  const unit = await prisma.unit.create({
    data: {
      propertyId,
      buildingId,
      unitNumber,
      unitType: (str(fd, "unitType") || "apartment") as UnitType,
      bedrooms,
      bathrooms,
      defaultRentAmountCents,
      serviceStatus: (str(fd, "serviceStatus") || "in_service") as ServiceStatus,
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
  return { ok: true };
}

export async function updateProperty(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("properties.manage");
  const propertyId = str(fd, "propertyId");
  const name = str(fd, "name");
  if (!propertyId || !name) return { error: "Property name is required." };
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) return { error: "Property not found." };

  const timezone = str(fd, "timezone") || property.timezone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { error: `Unknown IANA timezone: ${timezone}` };
  }
  // An invalid ISO-4217 code would make formatCurrency throw on every page
  // that renders money for this property — validate like the timezone.
  const currency = (str(fd, "currency") || property.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: `Currency must be a 3-letter ISO 4217 code, got: ${currency}` };
  }
  try {
    new Intl.NumberFormat("en-US", { style: "currency", currency });
  } catch {
    return { error: `Unknown ISO 4217 currency code: ${currency}` };
  }

  // Financing (Financials module): monthly mortgage payment + maturity date.
  const mortgageRaw = str(fd, "monthlyMortgage");
  const insuranceRaw = str(fd, "yearlyInsurance");
  const propertyTaxRaw = str(fd, "yearlyPropertyTax");
  let monthlyMortgageCents: bigint | null = null;
  let yearlyInsuranceCents: bigint | null = null;
  let yearlyPropertyTaxCents: bigint | null = null;
  try {
    if (mortgageRaw) monthlyMortgageCents = toCents(mortgageRaw);
    if (insuranceRaw) yearlyInsuranceCents = toCents(insuranceRaw);
    if (propertyTaxRaw) yearlyPropertyTaxCents = toCents(propertyTaxRaw);
  } catch {
    return {
      error:
        "Mortgage, insurance, and taxes must be valid amounts (e.g. 1500.00).",
    };
  }
  if (
    (monthlyMortgageCents != null && monthlyMortgageCents < 0n) ||
    (yearlyInsuranceCents != null && yearlyInsuranceCents < 0n) ||
    (yearlyPropertyTaxCents != null && yearlyPropertyTaxCents < 0n)
  ) {
    return { error: "Mortgage, insurance, and taxes cannot be negative." };
  }
  // Yearly fixed costs spread as /12 monthly columns in Financials; a zero
  // mortgage is treated as "none".
  if (monthlyMortgageCents === 0n) monthlyMortgageCents = null;
  const maturityRaw = str(fd, "mortgageMaturityDate");
  const mortgageMaturityDate = maturityRaw
    ? parseDateOnlyInZone(maturityRaw, timezone)
    : null;
  if (maturityRaw && !mortgageMaturityDate) {
    return { error: "Mortgage maturity date must be a valid date (YYYY-MM-DD)." };
  }
  const purchaseRaw = str(fd, "purchaseDate");
  const purchaseDate = purchaseRaw
    ? parseDateOnlyInZone(purchaseRaw, timezone)
    : null;
  if (purchaseRaw && !purchaseDate) {
    return { error: "Purchase date must be a valid date (YYYY-MM-DD)." };
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
    yearlyInsuranceCents,
    yearlyPropertyTaxCents,
    purchaseDate,
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
        yearlyInsuranceCents: property.yearlyInsuranceCents,
        yearlyPropertyTaxCents: property.yearlyPropertyTaxCents,
        purchaseDate: property.purchaseDate,
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
  return { ok: true };
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
