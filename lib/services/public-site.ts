import { prisma } from "@/lib/db";
import { compareVacancy, computeVacancy } from "@/lib/units/vacancy";

/**
 * Read-only data for the public marketing site. Everything here is intended for
 * logged-out visitors, so it exposes ONLY marketing-safe fields — never tenant
 * data, never occupied/off-market units.
 */

export interface PublicAvailabilityRow {
  unitId: string;
  propertyName: string;
  bedrooms: number | null;
  bathrooms: number | null;
  rentCents: bigint;
  availableNow: boolean;
  availableOn: Date | null;
}

/** "2 bd · 1 ba" (omits a missing side); "—" when neither is known. PURE. */
export function formatBedsBaths(
  bedrooms: number | null,
  bathrooms: number | null,
): string {
  const parts: string[] = [];
  if (bedrooms != null) parts.push(`${bedrooms} bd`);
  if (bathrooms != null) parts.push(`${bathrooms} ba`);
  return parts.join(" · ") || "—";
}

/** Stable availability label (UTC/en-US so it's deterministic). PURE. */
export function availabilityWhen(
  availableNow: boolean,
  availableOn: Date | null,
): string {
  if (availableNow) return "Available now";
  if (!availableOn) return "Available soon";
  const month = availableOn.toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `Available ${month} ${availableOn.getUTCDate()}, ${availableOn.getUTCFullYear()}`;
}

/**
 * Vacant / upcoming-vacant units across ACTIVE properties, soonest first, for
 * the public site. Bridges Prisma → the pure `computeVacancy` (never
 * re-implements it). Excludes occupied, maintenance, and off-market units, so
 * no tenant or non-marketing data can leak to a logged-out visitor.
 */
export async function listPublicAvailability(
  now: Date,
): Promise<PublicAvailabilityRow[]> {
  const units = await prisma.unit.findMany({
    where: { property: { isActive: true } },
    select: {
      id: true,
      bedrooms: true,
      bathrooms: true,
      defaultRentAmountCents: true,
      serviceStatus: true,
      availableFromDate: true,
      property: { select: { name: true } },
      leases: {
        where: { status: { in: ["active", "month_to_month"] } },
        select: { endDate: true },
        orderBy: { startDate: "desc" },
        take: 1,
      },
    },
  });

  return units
    .map((u) => {
      const lease = u.leases[0] ?? null;
      const vac = computeVacancy(
        {
          serviceStatus: u.serviceStatus,
          availableFromDate: u.availableFromDate,
          activeLeaseEndDate: lease?.endDate ?? null,
          hasActiveLease: !!lease,
        },
        now,
      );
      return { u, vac };
    })
    // Only available-now or a known upcoming vacancy — never maintenance,
    // unavailable, or occupied (which would expose a tenant's unit/off-market).
    .filter(({ vac }) => vac.availableNow || vac.state === "upcoming")
    .sort((a, b) => compareVacancy(a.vac, b.vac))
    .map(({ u, vac }) => ({
      unitId: u.id,
      propertyName: u.property.name,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      rentCents: u.defaultRentAmountCents,
      availableNow: vac.availableNow,
      availableOn: vac.availableOn,
    }));
}
