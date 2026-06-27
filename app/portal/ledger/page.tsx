import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requirePortalSession } from "@/lib/portal/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { getTenantLedgerFiltered } from "@/lib/services/reports";
import { formatCurrency } from "@/lib/money";
import {
  entryTypeLabel,
  parseEntryType,
  resolveLedgerFilter,
  TENANT_LEDGER_ENTRY_TYPES,
} from "@/lib/portal/ledger-export";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant-facing ledger with date-range + entry-type filters and a CSV download
 * of THEIR OWN ledger. requirePortalSession() is the only gate (/portal is a
 * staff-middleware PUBLIC_PREFIX) and every query is scoped to the signed-in
 * tenant's id — no client-supplied id is ever trusted. Gated on the
 * `tenantLedgerExport` module: with it off this page redirects to the portal
 * home, and the matching /api/portal/ledger route 404s, so the whole feature
 * (filters + export) disappears.
 */

const SELECT_CLASS = "h-9 w-full rounded-md border px-3 text-sm";

/** Decimal-string amount class: credit (negative) vs. charge (positive). */
function amountClass(v: string): string {
  return v.startsWith("-") ? "text-emerald-600 dark:text-emerald-400" : "";
}

export default async function PortalLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tenant } = await requirePortalSession();
  const settings = await getAppSettings();
  // Depends on both the portal and the export flag. requirePortalSession()
  // already redirects when tenantPortal is off (getPortalSession returns null),
  // so reaching here means the portal is on; the export flag is the live gate.
  if (!settings.modules.tenantPortal || !settings.modules.tenantLedgerExport) {
    redirect("/portal");
  }

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";
  const fromRaw = first(sp.from).trim();
  const toRaw = first(sp.to).trim();
  const typeRaw = first(sp.type).trim();

  // Timezone for civil-day bounds: the tenant's active lease property, else the
  // org default. Currency likewise. (Both scoped to THIS tenant.)
  const activeLease = await prisma.lease.findFirst({
    where: {
      OR: [
        { tenantId: tenant.id },
        { coTenants: { some: { tenantId: tenant.id } } },
      ],
      status: { in: ["active", "month_to_month"] },
    },
    orderBy: { startDate: "desc" },
    include: { unit: { include: { property: true } } },
  });
  const tz = activeLease?.unit.property.timezone ?? settings.defaultTimezone;
  const currency = activeLease?.unit.property.currency ?? settings.defaultCurrency;

  // Only keep the validated type in the echoed-back form value + export link.
  const selectedType = parseEntryType(typeRaw) ?? "";
  const filter = resolveLedgerFilter(
    { from: fromRaw, to: toRaw, type: typeRaw },
    tz,
  );
  const rows = await getTenantLedgerFiltered(tenant.id, filter);

  // Build the CSV link with only the *valid* params we actually applied.
  const exportQs = new URLSearchParams();
  if (filter.from) exportQs.set("from", fromRaw);
  if (filter.to) exportQs.set("to", toRaw);
  if (selectedType) exportQs.set("type", selectedType);
  const exportHref = exportQs.toString()
    ? `/api/portal/ledger?${exportQs.toString()}`
    : "/api/portal/ledger";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Account ledger</h1>
        <Button variant="ghost" size="sm" render={<Link href="/portal" />}>
          Back to portal
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter & export</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            method="GET"
            action="/portal/ledger"
            className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" name="from" type="date" defaultValue={fromRaw} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" name="to" type="date" defaultValue={toRaw} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                name="type"
                defaultValue={selectedType}
                className={SELECT_CLASS}
              >
                <option value="">All types</option>
                {TENANT_LEDGER_ENTRY_TYPES.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {entryTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit">Apply</Button>
              {(fromRaw || toRaw || selectedType) && (
                <Button
                  type="button"
                  variant="ghost"
                  render={<Link href="/portal/ledger" />}
                >
                  Clear
                </Button>
              )}
            </div>
          </form>
          <div className="flex justify-end border-t pt-4">
            <Button variant="outline" size="sm" render={<a href={exportHref} />}>
              Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Activity
            {rows.length > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                {rows.length} {rows.length === 1 ? "entry" : "entries"}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ledger entries match these filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="hidden py-2 pr-3 font-medium sm:table-cell">
                      Description
                    </th>
                    <th className="py-2 pl-3 text-right font-medium">Amount</th>
                    <th className="py-2 pl-3 text-right font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="py-2 pr-3 tabular-nums text-muted-foreground">
                        {r.date}
                      </td>
                      <td className="py-2 pr-3 capitalize">
                        {entryTypeLabel(r.type)}
                      </td>
                      <td className="hidden max-w-[18rem] truncate py-2 pr-3 text-muted-foreground sm:table-cell">
                        {r.description}
                      </td>
                      <td
                        className={`py-2 pl-3 text-right tabular-nums ${amountClass(r.amount)}`}
                      >
                        {formatCurrency(BigInt(r.amountCents ?? "0"), currency)}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {formatCurrency(BigInt(r.balanceCents ?? "0"), currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
