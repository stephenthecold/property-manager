import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/services/app-settings";

/**
 * Global search ("⌘K") — finds and deep-links to records across the app. A
 * read-only convenience over EXISTING operating records; it never reads or
 * returns money/balance data (labels are names/numbers only), so a result row
 * never leaks anything a list page wouldn't already show.
 *
 * Single-org app: every staff member with the gating capability searches all
 * records (see the API route). Queries are case-insensitive `contains` against
 * the same tables the list pages use.
 */

export type SearchKind = "tenant" | "property" | "unit" | "lease" | "maintenance";

export type SearchResult = {
  kind: SearchKind;
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

/** Bounds on the trimmed query (shared with the API route's validation). */
export const SEARCH_MIN_LEN = 1;
export const SEARCH_MAX_LEN = 100;

/** Per-kind result cap so one noisy table can't crowd out the others. */
const PER_KIND = 5;

/** Human label for a unit's place in the hierarchy ("Maple Apartments · #2B"). */
function unitLabel(property: { name: string } | null | undefined, unitNumber: string): string {
  return property?.name ? `${property.name} · #${unitNumber}` : `Unit #${unitNumber}`;
}

/**
 * Search tenants, properties, units, leases, and maintenance jobs by free text.
 * Returns up to `opts.limit` results total (default 25), at most PER_KIND per
 * kind. An out-of-bounds query (empty/too long) returns `[]`.
 */
export async function globalSearch(
  q: string,
  opts: { limit?: number } = {},
): Promise<SearchResult[]> {
  const term = q.trim();
  if (term.length < SEARCH_MIN_LEN || term.length > SEARCH_MAX_LEN) return [];
  const totalLimit = opts.limit ?? PER_KIND * 5;

  // Maintenance is an optional module; when it's off its detail pages redirect,
  // so don't surface jobs (disabling hides UI, never deletes data).
  const { modules } = await getAppSettings();
  const maintenanceEnabled = modules.maintenance;

  // Prisma parameterizes these; `contains` is a literal LIKE, not a regex, so no
  // injection / ReDoS surface. mode:"insensitive" => case-insensitive ILIKE.
  const contains = { contains: term, mode: "insensitive" as const };

  const [tenants, properties, units, leases, jobs] = await Promise.all([
    prisma.tenant.findMany({
      where: {
        OR: [
          { firstName: contains },
          { lastName: contains },
          { email: contains },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: PER_KIND,
    }),
    prisma.property.findMany({
      where: {
        OR: [
          { name: contains },
          { addressLine1: contains },
          { addressLine2: contains },
          { city: contains },
          { state: contains },
          { zip: contains },
        ],
      },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { name: "asc" },
      take: PER_KIND,
    }),
    prisma.unit.findMany({
      where: { unitNumber: contains },
      select: {
        id: true,
        unitNumber: true,
        property: { select: { name: true } },
      },
      orderBy: { unitNumber: "asc" },
      take: PER_KIND,
    }),
    // Leases have no free-text field of their own — reach them by tenant name or
    // unit number, the two human handles staff use to find a lease.
    prisma.lease.findMany({
      where: {
        // Archived leases are hidden everywhere but the explicit Archived view
        // (see the leases list page), so don't surface them in search either.
        isArchived: false,
        OR: [
          { tenant: { firstName: contains } },
          { tenant: { lastName: contains } },
          { unit: { unitNumber: contains } },
        ],
      },
      select: {
        id: true,
        tenantId: true,
        tenant: { select: { firstName: true, lastName: true } },
        unit: {
          select: { unitNumber: true, property: { select: { name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
    }),
    maintenanceEnabled
      ? prisma.maintenanceJob.findMany({
          where: { title: contains },
          select: {
            id: true,
            title: true,
            property: { select: { name: true } },
            unit: { select: { unitNumber: true } },
          },
          orderBy: { createdAt: "desc" },
          take: PER_KIND,
        })
      : Promise.resolve([]),
  ]);

  const results: SearchResult[] = [];

  for (const t of tenants) {
    results.push({
      kind: "tenant",
      id: t.id,
      label: `${t.firstName} ${t.lastName}`.trim(),
      sublabel: t.email ?? undefined,
      href: `/tenants/${t.id}`,
    });
  }
  for (const p of properties) {
    const place = [p.city, p.state].filter(Boolean).join(", ");
    results.push({
      kind: "property",
      id: p.id,
      label: p.name,
      sublabel: place || undefined,
      href: `/properties/${p.id}`,
    });
  }
  for (const u of units) {
    results.push({
      kind: "unit",
      id: u.id,
      label: unitLabel(u.property, u.unitNumber),
      sublabel: "Unit",
      href: `/units/${u.id}`,
    });
  }
  for (const l of leases) {
    // There is no /leases/[id] detail page — a lease (its terms + ledger) lives
    // on the primary tenant's page, which is how the rest of the app links to it.
    results.push({
      kind: "lease",
      id: l.id,
      label: `${l.tenant.firstName} ${l.tenant.lastName}`.trim(),
      sublabel: `Lease · ${unitLabel(l.unit.property, l.unit.unitNumber)}`,
      href: `/tenants/${l.tenantId}`,
    });
  }
  for (const j of jobs) {
    const loc = j.unit
      ? unitLabel(j.property, j.unit.unitNumber)
      : j.property?.name;
    results.push({
      kind: "maintenance",
      id: j.id,
      label: j.title,
      sublabel: loc ?? undefined,
      href: `/maintenance/${j.id}`,
    });
  }

  return results.slice(0, totalLimit);
}
