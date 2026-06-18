import { NextResponse } from "next/server";
import { authorizeApiCapability } from "@/lib/auth/session";
import { toCsv } from "@/lib/services/reports";
import {
  AUDIT_CSV_HEADERS,
  auditCsvRows,
  buildAuditWhere,
  type AuditFilters,
} from "@/lib/services/audit-export";

export const runtime = "nodejs";

/**
 * CSV export of the audit log, applying the same filters as /audit. Gated on
 * `audit.view` (the same capability as the page) — the trail is sensitive, so a
 * read-only viewer without it gets 401/403, never the data.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const auth = await authorizeApiCapability("audit.view");
  if (!auth.ok) {
    return new NextResponse(auth.status === 401 ? "Unauthorized" : "Forbidden", {
      status: auth.status,
    });
  }

  const sp = new URL(req.url).searchParams;
  const g = (k: string) => (sp.get(k) ?? "").trim();
  const filters: AuditFilters = {
    action: g("action"),
    entityType: g("entityType"),
    entityId: g("entityId"),
    actorEmail: g("actorEmail"),
    from: g("from"),
    to: g("to"),
  };

  const rows = await auditCsvRows(buildAuditWhere(filters));
  const csv = toCsv([...AUDIT_CSV_HEADERS], rows);
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-log-${stamp}.csv"`,
    },
  });
}
