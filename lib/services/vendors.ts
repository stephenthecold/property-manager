import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import type { VendorTrade } from "@/lib/generated/prisma/enums";

/**
 * Vendor directory service. A vendor is reference data (contractors/service
 * providers) — it never touches the ledger. Every mutation is audited; vendors
 * are deactivated (kept), never hard-deleted.
 */

export interface VendorInput {
  name: string;
  trade: VendorTrade;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  mailingAddress: string | null;
  notes: string | null;
}

export async function listVendors() {
  return prisma.vendor.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function createVendor(input: {
  data: VendorInput;
  actor: AuditContext;
}): Promise<{ id: string } | { error: string }> {
  const name = input.data.name.trim();
  if (!name) return { error: "Name is required." };

  const created = await withAudit(
    {
      ...input.actor,
      action: "vendor.created",
      entityType: "Vendor",
      entityId: "(new)",
    },
    async (tx) => {
      const row = await tx.vendor.create({
        data: {
          name,
          trade: input.data.trade,
          contactName: input.data.contactName,
          email: input.data.email,
          phone: input.data.phone,
          mailingAddress: input.data.mailingAddress,
          notes: input.data.notes,
          createdBy: input.actor.actorId ?? null,
        },
      });
      return { result: row, entityId: row.id, after: { name, trade: input.data.trade } };
    },
  );
  return { id: created.id };
}

export async function updateVendor(input: {
  id: string;
  data: VendorInput;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const vendor = await prisma.vendor.findUnique({ where: { id: input.id } });
  if (!vendor) return { ok: false, error: "Vendor not found." };
  const name = input.data.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  await withAudit(
    {
      ...input.actor,
      action: "vendor.updated",
      entityType: "Vendor",
      entityId: vendor.id,
    },
    async (tx) => {
      await tx.vendor.update({
        where: { id: vendor.id },
        data: {
          name,
          trade: input.data.trade,
          contactName: input.data.contactName,
          email: input.data.email,
          phone: input.data.phone,
          mailingAddress: input.data.mailingAddress,
          notes: input.data.notes,
        },
      });
      return { result: undefined, after: { name, trade: input.data.trade } };
    },
  );
  return { ok: true };
}

export async function setVendorActive(input: {
  id: string;
  isActive: boolean;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const vendor = await prisma.vendor.findUnique({ where: { id: input.id } });
  if (!vendor) return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: input.isActive ? "vendor.activated" : "vendor.deactivated",
      entityType: "Vendor",
      entityId: vendor.id,
    },
    async (tx) => {
      await tx.vendor.update({ where: { id: vendor.id }, data: { isActive: input.isActive } });
      return { result: undefined, after: { isActive: input.isActive } };
    },
  );
  return { ok: true };
}
