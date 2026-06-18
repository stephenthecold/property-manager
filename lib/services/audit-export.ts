import { prisma } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Shared query-building for the audit log so the page (paged view) and the CSV
 * export route apply IDENTICAL filters. Read-only; the audit trail is
 * append-only and this never writes.
 */

export interface AuditFilters {
  action: string;
  entityType: string;
  entityId: string;
  actorEmail: string;
  from: string; // "yyyy-MM-dd"
  to: string; // "yyyy-MM-dd", inclusive
}

export function buildAuditWhere(f: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (f.action) where.action = { contains: f.action, mode: "insensitive" };
  if (f.entityType) where.entityType = { contains: f.entityType, mode: "insensitive" };
  if (f.entityId) where.entityId = { contains: f.entityId, mode: "insensitive" };
  if (f.actorEmail) where.actorEmail = { contains: f.actorEmail, mode: "insensitive" };
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (f.from) {
    const d = new Date(`${f.from}T00:00:00`);
    if (!Number.isNaN(d.getTime())) createdAt.gte = d;
  }
  if (f.to) {
    const d = new Date(`${f.to}T23:59:59.999`); // inclusive end-of-day
    if (!Number.isNaN(d.getTime())) createdAt.lte = d;
  }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;
  return where;
}

export const AUDIT_CSV_HEADERS = [
  "timestamp",
  "actorType",
  "actorEmail",
  "action",
  "entityType",
  "entityId",
  "viaBreakGlass",
] as const;

/** Cap on a single export so one click can't stream the whole table. */
const EXPORT_LIMIT = 10000;

/** Filtered audit rows shaped for {@link toCsv} (keys = AUDIT_CSV_HEADERS),
 *  newest first. before/after JSON is intentionally omitted — it's viewable in
 *  the app and would bloat / leak nested values into a flat CSV. */
export async function auditCsvRows(
  where: Prisma.AuditLogWhereInput,
): Promise<Record<string, string>[]> {
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: EXPORT_LIMIT,
    select: {
      createdAt: true,
      actorType: true,
      actorEmail: true,
      action: true,
      entityType: true,
      entityId: true,
      viaBreakGlass: true,
    },
  });
  return rows.map((r) => ({
    timestamp: r.createdAt.toISOString(),
    actorType: r.actorType,
    actorEmail: r.actorEmail ?? "",
    action: r.action,
    entityType: r.entityType ?? "",
    entityId: r.entityId ?? "",
    viaBreakGlass: r.viaBreakGlass ? "yes" : "",
  }));
}
