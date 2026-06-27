import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getPortalSession } from "@/lib/portal/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { getTenantLedgerFiltered, LEDGER_HEADERS, toCsv } from "@/lib/services/reports";
import { resolveLedgerFilter } from "@/lib/portal/ledger-export";

/**
 * Resident-portal ledger CSV export. /api/portal is a staff-middleware
 * PUBLIC_PREFIX, so the PORTAL session is the only gate here. The export is
 * scoped STRICTLY to the signed-in tenant — the tenant id comes from the
 * resolved session (identity.tenant.id), NEVER from the request — so no query
 * param can widen it to another tenant's ledger. Gated on the
 * `tenantLedgerExport` module: 404 when it's off (so the surface disappears
 * entirely). Optional date-range + entry-type filters mirror the on-page view.
 */

export const runtime = "nodejs";

export async function GET(req: Request) {
  const identity = await getPortalSession();
  if (!identity) return new NextResponse("Unauthorized", { status: 401 });

  // The export depends on BOTH the portal being on and the export flag. The
  // portal gate is already enforced (getPortalSession returns null when
  // tenantPortal is off), but check both so the documented dependency holds.
  const settings = await getAppSettings();
  if (!settings.modules.tenantPortal || !settings.modules.tenantLedgerExport) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Timezone for the civil-day filter bounds: the signed-in tenant's active
  // lease property, else the org default. (Scoped to THIS tenant.)
  const activeLease = await prisma.lease.findFirst({
    where: {
      OR: [
        { tenantId: identity.tenant.id },
        { coTenants: { some: { tenantId: identity.tenant.id } } },
      ],
      status: { in: ["active", "month_to_month"] },
    },
    orderBy: { startDate: "desc" },
    include: { unit: { include: { property: true } } },
  });
  const tz = activeLease?.unit.property.timezone ?? settings.defaultTimezone;

  const q = new URL(req.url).searchParams;
  const filter = resolveLedgerFilter(
    { from: q.get("from"), to: q.get("to"), type: q.get("type") },
    tz,
  );

  const rows = (await getTenantLedgerFiltered(
    identity.tenant.id,
    filter,
  )) as unknown as Record<string, string>[];

  const csv = toCsv([...LEDGER_HEADERS], rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ledger.csv"',
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
