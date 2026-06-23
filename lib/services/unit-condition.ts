import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { saveMaintenancePhotos } from "@/lib/services/maintenance-photos";
import { getFileStorage } from "@/lib/providers/storage";
import type { UnitConditionPhase } from "@/lib/generated/prisma/enums";

/**
 * Unit condition photos (module "inspections"): dated photo batches documenting
 * how a unit is given to / left by a tenant, or a vacant turnover. A batch is
 * anchored to a UNIT (so it shows historically there) with an optional tenancy
 * link; photos are UploadedDocument rows (uploadType "condition_photo"). One
 * note per batch. An OPERATING record — it never touches the ledger, balances,
 * or deposit disposition.
 */

export const CONDITION_PHASES: UnitConditionPhase[] = [
  "move_in",
  "move_out",
  "turnover",
  "other",
];

export function isConditionPhase(v: string): v is UnitConditionPhase {
  return (CONDITION_PHASES as string[]).includes(v);
}

export function conditionPhaseLabel(phase: UnitConditionPhase): string {
  switch (phase) {
    case "move_in":
      return "Move-in";
    case "move_out":
      return "Move-out";
    case "turnover":
      return "Turnover";
    default:
      return "Other";
  }
}

export interface ConditionPhoto {
  id: string;
  url: string | null; // null when storage is unavailable — render a placeholder
  fileName: string | null;
}

export interface ConditionLogView {
  id: string;
  unitId: string;
  phase: UnitConditionPhase;
  conditionDate: Date;
  note: string | null;
  leaseId: string | null;
  tenantName: string | null;
  photos: ConditionPhoto[];
}

/** Load condition logs (newest first) with their photos + signed URLs. */
async function loadConditionLogs(
  where: { unitId?: string; leaseId?: string },
): Promise<ConditionLogView[]> {
  const logs = await prisma.unitConditionLog.findMany({
    where,
    orderBy: { conditionDate: "desc" },
    include: {
      lease: { include: { tenant: { select: { firstName: true, lastName: true } } } },
    },
  });
  if (logs.length === 0) return [];

  const docs = await prisma.uploadedDocument.findMany({
    where: { unitConditionLogId: { in: logs.map((l) => l.id) }, fileType: { startsWith: "image/" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, fileName: true, unitConditionLogId: true },
  });
  const byLog = new Map<string, typeof docs>();
  for (const d of docs) {
    if (!d.unitConditionLogId) continue;
    const list = byLog.get(d.unitConditionLogId) ?? [];
    list.push(d);
    byLog.set(d.unitConditionLogId, list);
  }

  return Promise.all(
    logs.map(async (l) => ({
      id: l.id,
      unitId: l.unitId,
      phase: l.phase,
      conditionDate: l.conditionDate,
      note: l.note,
      leaseId: l.leaseId,
      tenantName: l.lease
        ? `${l.lease.tenant.firstName} ${l.lease.tenant.lastName}`
        : null,
      photos: await Promise.all(
        (byLog.get(l.id) ?? []).map(async (d) => {
          let url: string | null = null;
          try {
            url = (await getDocumentDownloadUrl(d.id))?.url ?? null;
          } catch {
            url = null;
          }
          return { id: d.id, url, fileName: d.fileName };
        }),
      ),
    })),
  );
}

export function listConditionLogsForUnit(unitId: string): Promise<ConditionLogView[]> {
  return loadConditionLogs({ unitId });
}

export function listConditionLogsForLease(leaseId: string): Promise<ConditionLogView[]> {
  return loadConditionLogs({ leaseId });
}

/**
 * Create a condition batch and store its photos. The batch is only kept if at
 * least one valid image lands — otherwise it's removed so we never leave an
 * empty record. Best-effort photo saving (reuses the magic-byte validator).
 */
export async function createConditionLog(input: {
  unitId: string;
  leaseId: string | null;
  phase: UnitConditionPhase;
  conditionDate: Date;
  note: string | null;
  files: File[];
  actor: AuditContext;
}): Promise<{ ok: true; saved: number; skipped: number } | { error: string }> {
  const unit = await prisma.unit.findUnique({
    where: { id: input.unitId },
    select: { id: true },
  });
  if (!unit) return { error: "Unit not found." };

  // A tenancy link must belong to THIS unit (no cross-unit attribution).
  if (input.leaseId) {
    const lease = await prisma.lease.findUnique({
      where: { id: input.leaseId },
      select: { unitId: true },
    });
    if (!lease || lease.unitId !== input.unitId) {
      return { error: "The selected tenancy isn't on this unit." };
    }
  }

  const hasFile = input.files.some((f) => f instanceof File && f.size > 0);
  if (!hasFile) return { error: "Add at least one photo." };

  const log = await withAudit(
    {
      ...input.actor,
      action: "unit_condition.created",
      entityType: "UnitConditionLog",
      entityId: "(new)",
    },
    async (tx) => {
      const row = await tx.unitConditionLog.create({
        data: {
          unitId: input.unitId,
          leaseId: input.leaseId,
          phase: input.phase,
          conditionDate: input.conditionDate,
          note: input.note,
          createdBy: input.actor.actorId ?? null,
        },
      });
      return {
        result: row,
        entityId: row.id,
        after: {
          unitId: input.unitId,
          leaseId: input.leaseId,
          phase: input.phase,
          conditionDate: input.conditionDate,
        },
      };
    },
  );

  const res = await saveMaintenancePhotos({
    files: input.files,
    unitConditionLogId: log.id,
    note: "", // one note per batch lives on the log, not per photo
    uploadType: "condition_photo",
    actor: input.actor,
  });

  if (res.saved === 0) {
    // No usable image landed — don't leave an empty batch behind.
    await prisma.unitConditionLog.delete({ where: { id: log.id } }).catch(() => {});
    return {
      error: res.storageError
        ? "File storage isn't configured — photos can't be saved."
        : "No valid images — use JPG/PNG/WebP under 10 MB.",
    };
  }
  return { ok: true, saved: res.saved, skipped: res.skipped };
}

/** Delete a condition batch and its photos (DB rows + best-effort storage). */
export async function deleteConditionLog(
  id: string,
  actor: AuditContext,
): Promise<void> {
  const log = await prisma.unitConditionLog.findUnique({ where: { id } });
  if (!log) return;
  const docs = await prisma.uploadedDocument.findMany({
    where: { unitConditionLogId: id },
    select: { fileUrl: true },
  });

  await withAudit(
    {
      ...actor,
      action: "unit_condition.deleted",
      entityType: "UnitConditionLog",
      entityId: id,
      before: { unitId: log.unitId, phase: log.phase, conditionDate: log.conditionDate },
    },
    async (tx) => {
      await tx.uploadedDocument.deleteMany({ where: { unitConditionLogId: id } });
      await tx.unitConditionLog.delete({ where: { id } });
      return { result: undefined };
    },
  );

  // Best-effort storage cleanup after the DB commit.
  const storage = await getFileStorage();
  for (const d of docs) {
    try {
      await storage.delete(d.fileUrl);
    } catch {
      // orphaned object is harmless; don't fail the delete
    }
  }
}
