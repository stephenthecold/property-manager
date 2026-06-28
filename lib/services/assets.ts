import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";

/**
 * Asset / equipment registry service (module "maintenance"). An asset is an
 * operating record (water heaters, HVAC, appliances) — it never touches the
 * ledger or tenant balances. Every mutation is audited; assets are
 * deactivated (kept), never hard-deleted. Standalone from MaintenanceJob.
 *
 * Capability gating (maintenance.manage) and module checks live in the calling
 * server actions, mirroring lib/services/vendors.ts — this keeps the service
 * importable by the worker/CLI (which can't pull in the server-only session).
 */

export interface AssetInput {
  name: string;
  category: string | null;
  propertyId: string;
  unitId: string | null;
  make: string | null;
  model: string | null;
  serialNumber: string | null;
  installedOn: Date | null;
  warrantyExpiresOn: Date | null;
  notes: string | null;
}

/**
 * Asset registry. Active-only by default; pass view "all" to include
 * deactivated assets (the page exposes this as a "Show" toggle).
 */
export async function listAssets(view: "active" | "all" = "active") {
  return prisma.asset.findMany({
    where: view === "all" ? {} : { active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    include: {
      // timezone drives date-only render + warranty math (property-tz, not UTC).
      property: { select: { id: true, name: true, timezone: true } },
      unit: { select: { id: true, unitNumber: true } },
    },
  });
}

export async function createAsset(input: {
  data: AssetInput;
  actor: AuditContext;
}): Promise<{ id: string } | { error: string }> {
  const name = input.data.name.trim();
  if (!name) return { error: "Name is required." };
  if (!input.data.propertyId) return { error: "Property is required." };

  // Validate the property (and unit, if given) exist and the unit belongs to
  // the chosen property — the picker only offers valid pairs, but never trust
  // it for a write.
  const property = await prisma.property.findUnique({
    where: { id: input.data.propertyId },
    select: { id: true },
  });
  if (!property) return { error: "Property not found." };
  if (input.data.unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: input.data.unitId },
      select: { propertyId: true },
    });
    if (!unit) return { error: "Unit not found." };
    if (unit.propertyId !== input.data.propertyId) {
      return { error: "That unit is not in the selected property." };
    }
  }

  const created = await withAudit(
    {
      ...input.actor,
      action: "asset.created",
      entityType: "Asset",
      entityId: "(new)",
    },
    async (tx) => {
      const row = await tx.asset.create({
        data: {
          name,
          category: input.data.category,
          propertyId: input.data.propertyId,
          unitId: input.data.unitId,
          make: input.data.make,
          model: input.data.model,
          serialNumber: input.data.serialNumber,
          installedOn: input.data.installedOn,
          warrantyExpiresOn: input.data.warrantyExpiresOn,
          notes: input.data.notes,
          createdBy: input.actor.actorId ?? null,
        },
      });
      return {
        result: row,
        entityId: row.id,
        after: { name, propertyId: input.data.propertyId, unitId: input.data.unitId },
      };
    },
  );
  return { id: created.id };
}

export async function updateAsset(input: {
  id: string;
  data: AssetInput;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const asset = await prisma.asset.findUnique({ where: { id: input.id } });
  if (!asset) return { ok: false, error: "Asset not found." };
  const name = input.data.name.trim();
  if (!name) return { ok: false, error: "Name is required." };
  if (!input.data.propertyId) return { ok: false, error: "Property is required." };

  const property = await prisma.property.findUnique({
    where: { id: input.data.propertyId },
    select: { id: true },
  });
  if (!property) return { ok: false, error: "Property not found." };
  if (input.data.unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: input.data.unitId },
      select: { propertyId: true },
    });
    if (!unit) return { ok: false, error: "Unit not found." };
    if (unit.propertyId !== input.data.propertyId) {
      return { ok: false, error: "That unit is not in the selected property." };
    }
  }

  await withAudit(
    {
      ...input.actor,
      action: "asset.updated",
      entityType: "Asset",
      entityId: asset.id,
      before: { name: asset.name, propertyId: asset.propertyId, unitId: asset.unitId },
    },
    async (tx) => {
      await tx.asset.update({
        where: { id: asset.id },
        data: {
          name,
          category: input.data.category,
          propertyId: input.data.propertyId,
          unitId: input.data.unitId,
          make: input.data.make,
          model: input.data.model,
          serialNumber: input.data.serialNumber,
          installedOn: input.data.installedOn,
          warrantyExpiresOn: input.data.warrantyExpiresOn,
          notes: input.data.notes,
        },
      });
      return {
        result: undefined,
        after: { name, propertyId: input.data.propertyId, unitId: input.data.unitId },
      };
    },
  );
  return { ok: true };
}

export async function setAssetActive(input: {
  id: string;
  active: boolean;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const asset = await prisma.asset.findUnique({ where: { id: input.id } });
  if (!asset) return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: input.active ? "asset.activated" : "asset.deactivated",
      entityType: "Asset",
      entityId: asset.id,
    },
    async (tx) => {
      await tx.asset.update({ where: { id: asset.id }, data: { active: input.active } });
      return { result: undefined, after: { active: input.active } };
    },
  );
  return { ok: true };
}
