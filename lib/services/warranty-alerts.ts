import { prisma } from "@/lib/db";
import { daysBetween } from "@/lib/accounting/periods";
import { warrantyState } from "@/lib/maintenance/warranty";

export interface ExpiringWarranty {
  assetId: string;
  assetName: string;
  propertyName: string;
  unitLabel: string | null;
  timezone: string;
  warrantyExpiresOn: Date;
  state: "expired" | "expiring_soon";
  daysUntil: number;
}

/**
 * Active registered assets whose warranty is expired or expiring within 30 days,
 * classified in each asset's property timezone via the pure warrantyState().
 * Shared by the weekly warranty digest (staff-digest.ts) and the dashboard
 * widget. Soonest / most-overdue first. DB read only — no side effects.
 */
export async function listExpiringWarranties(
  now: Date,
): Promise<ExpiringWarranty[]> {
  const assets = await prisma.asset.findMany({
    where: { active: true, warrantyExpiresOn: { not: null } },
    include: {
      property: { select: { name: true, timezone: true } },
      unit: { select: { unitNumber: true } },
    },
  });

  const rows: ExpiringWarranty[] = [];
  for (const a of assets) {
    const tz = a.property.timezone;
    const expiresOn = a.warrantyExpiresOn as Date;
    const state = warrantyState({ warrantyExpiresOn: expiresOn, now, tz });
    if (state !== "expired" && state !== "expiring_soon") continue;
    rows.push({
      assetId: a.id,
      assetName: a.name,
      propertyName: a.property.name,
      unitLabel: a.unit?.unitNumber ?? null,
      timezone: tz,
      warrantyExpiresOn: expiresOn,
      state,
      daysUntil: daysBetween(now, expiresOn, tz),
    });
  }
  rows.sort(
    (x, y) => x.daysUntil - y.daysUntil || x.assetName.localeCompare(y.assetName),
  );
  return rows;
}
