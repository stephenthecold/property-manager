import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import { computeDisposition, type DepositDisposition } from "@/lib/inspections/disposition";
import { saveMaintenancePhotos } from "@/lib/services/maintenance-photos";
import { getFileStorage } from "@/lib/providers/storage";
import type {
  InspectionChecklistStatus,
  InspectionType,
} from "@/lib/generated/prisma/enums";

/**
 * Bridges Inspection rows to the pure disposition math. Inspections are OPERATING
 * records — they never touch the ledger (deposits live on LeaseDeposit). Every
 * mutation is audited. The move-out deposit disposition is computed on read from
 * the lease's deposits minus the deduction amounts on the condition checklist.
 */

export async function listInspections() {
  return prisma.inspection.findMany({
    orderBy: [{ status: "asc" }, { scheduledFor: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: {
      _count: { select: { checklistItems: true } },
      lease: {
        select: {
          tenantId: true,
          tenant: { select: { firstName: true, lastName: true } },
          unit: { select: { id: true, unitNumber: true, property: { select: { name: true, timezone: true } } } },
        },
      },
    },
  });
}

export async function getInspection(id: string) {
  return prisma.inspection.findUnique({
    where: { id },
    include: {
      // Checklist items + their photos (and any move-out deduction amount) are
      // loaded separately via getInspectionChecklist() (it adds the photo join +
      // signed URLs), so they are intentionally NOT included here.
      template: { select: { id: true, name: true } },
      lease: {
        select: {
          id: true,
          tenantId: true,
          tenant: { select: { firstName: true, lastName: true } },
          unit: {
            select: {
              id: true,
              unitNumber: true,
              property: { select: { name: true, timezone: true, currency: true } },
            },
          },
        },
      },
    },
  });
}

/** Total + non-refundable deposit cents for a lease. */
async function depositTotals(leaseId: string): Promise<{
  depositTotalCents: bigint;
  nonRefundableCents: bigint;
}> {
  const agg = await prisma.leaseDeposit.aggregate({
    where: { leaseId },
    _sum: { amountCents: true, nonRefundableCents: true },
  });
  return {
    depositTotalCents: agg._sum.amountCents ?? 0n,
    nonRefundableCents: agg._sum.nonRefundableCents ?? 0n,
  };
}

/**
 * Move-out deposit disposition: the lease's deposits − the checklist deductions.
 * The caller passes the deductions total (summed from the already-loaded
 * checklist via sumChecklistDeductions), so the list and the total share one
 * source and we don't re-aggregate.
 */
export async function dispositionForInspection(
  leaseId: string,
  deductionsCents: bigint,
): Promise<DepositDisposition> {
  const totals = await depositTotals(leaseId);
  return computeDisposition({ ...totals, deductionsCents });
}

export async function createInspection(input: {
  leaseId: string;
  type: InspectionType;
  scheduledFor: Date | null;
  inspector: string | null;
  /** Optional template to pre-populate the condition checklist from. */
  templateId?: string | null;
  actor: AuditContext;
}): Promise<{ id: string } | { error: string }> {
  const lease = await prisma.lease.findUnique({
    where: { id: input.leaseId },
    select: { id: true },
  });
  if (!lease) return { error: "Lease not found." };

  // Load the chosen template's ordered items up front (a missing/inactive
  // template just means no pre-population — never an error the user can't act on).
  let templateItems: { label: string; area: string | null; category: string | null }[] = [];
  let templateId: string | null = null;
  if (input.templateId) {
    const template = await prisma.inspectionTemplate.findUnique({
      where: { id: input.templateId },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
    });
    if (template) {
      templateId = template.id;
      templateItems = template.items.map((it) => ({
        label: it.label,
        area: it.area,
        category: it.category,
      }));
    }
  }

  const created = await withAudit(
    {
      ...input.actor,
      action: "inspection.created",
      entityType: "Inspection",
      entityId: "(new)",
    },
    async (tx) => {
      const row = await tx.inspection.create({
        data: {
          leaseId: input.leaseId,
          type: input.type,
          status: "scheduled",
          scheduledFor: input.scheduledFor,
          inspector: input.inspector,
          templateId,
          createdBy: input.actor.actorId ?? null,
          // Snapshot the template's items onto this inspection (a copy — later
          // edits to the template never change a created inspection).
          checklistItems: {
            create: templateItems.map((it, i) => ({
              label: it.label,
              area: it.area,
              category: it.category,
              sortOrder: i,
            })),
          },
        },
      });
      return {
        result: row,
        entityId: row.id,
        after: {
          leaseId: input.leaseId,
          type: input.type,
          templateId,
          checklistItemCount: templateItems.length,
        },
      };
    },
  );
  return { id: created.id };
}

export async function completeInspection(input: {
  id: string;
  summary: string | null;
  completedAt: Date;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const insp = await prisma.inspection.findUnique({ where: { id: input.id } });
  if (!insp) return { ok: false, error: "Inspection not found." };
  if (insp.status === "canceled") {
    return { ok: false, error: "A canceled inspection can't be completed." };
  }
  await withAudit(
    {
      ...input.actor,
      action: "inspection.completed",
      entityType: "Inspection",
      entityId: insp.id,
    },
    async (tx) => {
      await tx.inspection.update({
        where: { id: insp.id },
        data: { status: "completed", completedAt: input.completedAt, summary: input.summary },
      });
      return { result: undefined, after: { completedAt: input.completedAt.toISOString() } };
    },
  );
  return { ok: true };
}

export async function cancelInspection(input: {
  id: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const insp = await prisma.inspection.findUnique({ where: { id: input.id } });
  if (!insp || insp.status === "canceled") return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "inspection.canceled",
      entityType: "Inspection",
      entityId: insp.id,
      before: { status: insp.status },
    },
    async (tx) => {
      await tx.inspection.update({ where: { id: insp.id }, data: { status: "canceled" } });
      return { result: undefined };
    },
  );
  return { ok: true };
}

// ---------------------------------------------------------------------------
// CHECKLIST items (condition observations). Each carries a pass/fail/na status,
// an optional note, photos (UploadedDocument rows, uploadType "inspection_photo"),
// and — on a move-out — an optional deposit-deduction amount. The move-out
// disposition sums those amounts. Operating records; never touch balances.
// ---------------------------------------------------------------------------

/** Add a blank condition checklist item to an inspection (appended at the end). */
export async function addChecklistItem(input: {
  inspectionId: string;
  label: string;
  area: string | null;
  category: string | null;
  /** Optional move-out deposit deduction for this item. */
  amountCents?: bigint;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const insp = await prisma.inspection.findUnique({
    where: { id: input.inspectionId },
    select: { id: true, status: true },
  });
  if (!insp) return { ok: false, error: "Inspection not found." };
  if (insp.status === "canceled") {
    return { ok: false, error: "A canceled inspection can't take checklist items." };
  }
  const last = await prisma.inspectionChecklistItem.findFirst({
    where: { inspectionId: insp.id },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await withAudit(
    {
      ...input.actor,
      action: "inspection.checklist_item_added",
      entityType: "Inspection",
      entityId: insp.id,
    },
    async (tx) => {
      await tx.inspectionChecklistItem.create({
        data: {
          inspectionId: insp.id,
          label: input.label,
          area: input.area,
          category: input.category,
          amountCents: input.amountCents ?? 0n,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
      return {
        result: undefined,
        after: { label: input.label, amountCents: (input.amountCents ?? 0n).toString() },
      };
    },
  );
  return { ok: true };
}

/** Update a checklist item's status and/or note (the condition assessment). */
export async function updateChecklistItem(input: {
  itemId: string;
  status: InspectionChecklistStatus;
  note: string | null;
  /** Deposit deduction for this item (move-out); 0 clears it. Omit to keep. */
  amountCents?: bigint;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.inspectionChecklistItem.findUnique({
    where: { id: input.itemId },
    select: { id: true, inspectionId: true, status: true, note: true, amountCents: true },
  });
  if (!item) return { ok: false, error: "Checklist item not found." };
  const amountCents = input.amountCents ?? item.amountCents;
  await withAudit(
    {
      ...input.actor,
      action: "inspection.checklist_item_updated",
      entityType: "Inspection",
      entityId: item.inspectionId,
      before: {
        status: item.status,
        note: item.note,
        amountCents: item.amountCents.toString(),
      },
    },
    async (tx) => {
      await tx.inspectionChecklistItem.update({
        where: { id: item.id },
        data: { status: input.status, note: input.note, amountCents },
      });
      return {
        result: undefined,
        after: { status: input.status, amountCents: amountCents.toString() },
      };
    },
  );
  return { ok: true };
}

/** Remove a checklist item AND its photos (DB rows + best-effort storage cleanup). */
export async function removeChecklistItem(input: {
  itemId: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const item = await prisma.inspectionChecklistItem.findUnique({
    where: { id: input.itemId },
    select: { id: true, inspectionId: true, label: true, amountCents: true },
  });
  if (!item) return { ok: true };
  const docs = await prisma.uploadedDocument.findMany({
    where: { inspectionChecklistItemId: item.id },
    select: { fileUrl: true },
  });
  await withAudit(
    {
      ...input.actor,
      action: "inspection.checklist_item_removed",
      entityType: "Inspection",
      entityId: item.inspectionId,
      before: { label: item.label, amountCents: item.amountCents.toString() },
    },
    async (tx) => {
      await tx.uploadedDocument.deleteMany({ where: { inspectionChecklistItemId: item.id } });
      await tx.inspectionChecklistItem.delete({ where: { id: item.id } });
      return { result: undefined };
    },
  );
  // Best-effort storage cleanup after the DB commit.
  const storage = await getFileStorage().catch(() => null);
  if (storage) {
    for (const d of docs) {
      try {
        await storage.delete(d.fileUrl);
      } catch {
        // orphaned object is harmless; don't fail the delete
      }
    }
  }
  return { ok: true };
}

/**
 * Attach photos to one checklist item. The item must belong to the given
 * inspection (callers pass the inspection id from the page that's already
 * capability-gated). Reuses the shared, magic-byte-validating photo saver.
 */
export async function addChecklistItemPhotos(input: {
  itemId: string;
  inspectionId: string;
  files: File[];
  actor: AuditContext;
}): Promise<{ ok: boolean; saved?: number; skipped?: number; error?: string }> {
  const item = await prisma.inspectionChecklistItem.findUnique({
    where: { id: input.itemId },
    select: { id: true, inspectionId: true },
  });
  if (!item || item.inspectionId !== input.inspectionId) {
    return { ok: false, error: "Checklist item not found." };
  }
  if (!input.files.some((f) => f instanceof File && f.size > 0)) {
    return { ok: false, error: "Choose at least one photo." };
  }
  let res: Awaited<ReturnType<typeof saveMaintenancePhotos>>;
  try {
    res = await saveMaintenancePhotos({
      files: input.files,
      inspectionChecklistItemId: item.id,
      note: "",
      uploadType: "inspection_photo",
      actor: input.actor,
    });
  } catch (e) {
    console.error("[inspections] checklist photo save threw:", e);
    return { ok: false, error: "Couldn't save the photos — check file storage and try again." };
  }
  if (res.saved === 0) {
    return {
      ok: false,
      error: res.storageError
        ? "File storage isn't configured — photos can't be saved."
        : "No valid images — use JPG/PNG/WebP under 10 MB.",
    };
  }
  return { ok: true, saved: res.saved, skipped: res.skipped };
}

/** Delete a single checklist-item photo (ownership-checked: the photo must hang
 *  off a checklist item that belongs to the given inspection). */
export async function deleteChecklistItemPhoto(input: {
  photoId: string;
  inspectionId: string;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const doc = await prisma.uploadedDocument.findUnique({
    where: { id: input.photoId },
    select: { id: true, fileUrl: true, inspectionChecklistItemId: true },
  });
  if (!doc || !doc.inspectionChecklistItemId) return { ok: true };
  // Confirm the photo's checklist item is on THIS inspection before deleting.
  const item = await prisma.inspectionChecklistItem.findUnique({
    where: { id: doc.inspectionChecklistItemId },
    select: { inspectionId: true },
  });
  if (!item || item.inspectionId !== input.inspectionId) {
    return { ok: false, error: "Photo not found." };
  }
  await withAudit(
    {
      ...input.actor,
      action: "inspection.checklist_photo_removed",
      entityType: "UploadedDocument",
      entityId: doc.id,
      before: { inspectionChecklistItemId: doc.inspectionChecklistItemId },
    },
    async (tx) => {
      await tx.uploadedDocument.delete({ where: { id: doc.id } });
      return { result: undefined };
    },
  );
  const storage = await getFileStorage().catch(() => null);
  if (storage) {
    try {
      await storage.delete(doc.fileUrl);
    } catch {
      // orphaned object is harmless
    }
  }
  return { ok: true };
}

export interface ChecklistPhotoView {
  id: string;
  url: string | null; // null when storage is unavailable — render a placeholder
  fileName: string | null;
}

/**
 * Load an inspection's checklist items with their photos (signed, short-lived
 * URLs), ordered. Photos are served through the existing signed-URL + /api/files
 * path — the SAME mechanism as condition/maintenance photos — so access stays
 * gated by a staff session plus the page-level inspections.manage capability.
 */
export async function getInspectionChecklist(inspectionId: string): Promise<
  {
    id: string;
    label: string;
    area: string | null;
    category: string | null;
    status: InspectionChecklistStatus;
    note: string | null;
    amountCents: bigint;
    photos: ChecklistPhotoView[];
  }[]
> {
  const items = await prisma.inspectionChecklistItem.findMany({
    where: { inspectionId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (items.length === 0) return [];

  const storage = await getFileStorage().catch(() => null);
  const docs = await prisma.uploadedDocument.findMany({
    where: {
      inspectionChecklistItemId: { in: items.map((i) => i.id) },
      fileType: { startsWith: "image/" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, fileUrl: true, inspectionChecklistItemId: true },
  });
  const byItem = new Map<string, typeof docs>();
  for (const d of docs) {
    if (!d.inspectionChecklistItemId) continue;
    const list = byItem.get(d.inspectionChecklistItemId) ?? [];
    list.push(d);
    byItem.set(d.inspectionChecklistItemId, list);
  }

  return Promise.all(
    items.map(async (it) => ({
      id: it.id,
      label: it.label,
      area: it.area,
      category: it.category,
      status: it.status,
      note: it.note,
      amountCents: it.amountCents,
      photos: await Promise.all(
        (byItem.get(it.id) ?? []).map(async (d) => {
          let url: string | null = null;
          if (storage) {
            try {
              url = await storage.getSignedUrl(d.fileUrl);
            } catch {
              url = null; // storage hiccup — render a placeholder
            }
          }
          return { id: d.id, url, fileName: d.fileName };
        }),
      ),
    })),
  );
}
