"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * One vacant/upcoming unit, fully serialized for the client: money as a string
 * of integer cents (never a float across the RSC boundary), and the display
 * labels precomputed server-side by the pure public-site helpers. `availSort`
 * is an ascending sort key (epoch ms; 0 = available now / soonest).
 */
export interface VacancyCard {
  unitId: string;
  propertyName: string;
  bedsBaths: string;
  rentCents: string;
  rentLabel: string;
  whenLabel: string;
  availSort: number;
  applyHref: string | null;
}

type SortKey = "availability" | "rent_asc" | "rent_desc";

const SELECT_CLASS =
  "h-9 rounded-md border bg-card px-2 text-sm text-foreground";

/** Exact integer-cents compare via BigInt — never parse rent as a float. */
function compareRent(a: string, b: string): number {
  const av = BigInt(a);
  const bv = BigInt(b);
  return av < bv ? -1 : av > bv ? 1 : 0;
}

/**
 * Client-side filter (by property) + sort (rent / availability) over a card
 * grid of vacancies. Rows arrive pre-rendered/serialized from the server; this
 * only narrows and reorders them, mirroring how DataTable works for lists.
 */
export function VacanciesBrowser({ units }: { units: VacancyCard[] }) {
  const [property, setProperty] = React.useState<string>("");
  const [sort, setSort] = React.useState<SortKey>("availability");

  const properties = React.useMemo(
    () => Array.from(new Set(units.map((u) => u.propertyName))).sort((a, b) =>
      a.localeCompare(b),
    ),
    [units],
  );

  const visible = React.useMemo(() => {
    const filtered = property
      ? units.filter((u) => u.propertyName === property)
      : units;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sort === "rent_asc") return compareRent(a.rentCents, b.rentCents);
      if (sort === "rent_desc") return compareRent(b.rentCents, a.rentCents);
      // availability: soonest first, then by property for a stable order
      return a.availSort - b.availSort || a.propertyName.localeCompare(b.propertyName);
    });
    return sorted;
  }, [units, property, sort]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          {properties.length > 1 && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Property</span>
              <select
                value={property}
                onChange={(e) => setProperty(e.target.value)}
                className={SELECT_CLASS}
                aria-label="Filter by property"
              >
                <option value="">All properties</option>
                {properties.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Sort by</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={SELECT_CLASS}
              aria-label="Sort vacancies"
            >
              <option value="availability">Availability (soonest)</option>
              <option value="rent_asc">Rent (low to high)</option>
              <option value="rent_desc">Rent (high to low)</option>
            </select>
          </label>
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          {visible.length} {visible.length === 1 ? "unit" : "units"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((u) => (
          <div
            key={u.unitId}
            className="flex flex-col rounded-lg border bg-card p-4 text-card-foreground"
          >
            <div className="font-medium">{u.propertyName}</div>
            <div className="mt-1 text-sm text-muted-foreground">{u.bedsBaths}</div>
            <div className="mt-2 text-lg font-semibold">
              {u.rentLabel}
              <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{u.whenLabel}</div>
            {u.applyHref && (
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                render={<Link href={u.applyHref} />}
              >
                Apply
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
