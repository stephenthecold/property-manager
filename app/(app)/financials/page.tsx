import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDisplayRole, requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability } from "@/lib/auth/permissions";
import {
  getFinancialSummary,
  type PropertyFinancialRow,
} from "@/lib/services/financials";
import {
  groupByEntity,
  type PortfolioGroup,
  type PortfolioSubtotal,
} from "@/lib/accounting/portfolio";
import { listActiveVendors } from "@/lib/services/vendors";
import { formatCurrency } from "@/lib/money";
import type { ExpenseCategory } from "@/lib/generated/prisma/enums";
import type { Prisma } from "@/lib/generated/prisma/client";
import { createExpenseAction, deleteExpenseAction } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";

const CATEGORIES = ["utilities", "insurance", "maintenance", "taxes", "other"] as const;

function netClass(cents: bigint): string {
  if (cents < 0n) return "text-red-600 dark:text-red-400";
  if (cents > 0n) return "text-emerald-600 dark:text-emerald-400";
  return "";
}

/** Net-income-by-property columns, shared by the flat DataTable and the
 *  entity-grouped Table (Portfolio module) so they never drift apart. */
const NET_INCOME_COLUMNS = [
  { key: "property", label: "Property", align: "left" as const, className: "" },
  { key: "leases", label: "Leases", align: "right" as const, numeric: true, className: "hidden sm:table-cell" },
  { key: "expected", label: "Expected /mo", align: "right" as const, numeric: true, className: "hidden md:table-cell" },
  { key: "collected", label: "Collected", align: "right" as const, numeric: true, className: "" },
  { key: "mortgage", label: "Mortgage /mo", align: "right" as const, numeric: true, className: "" },
  { key: "insurance", label: "Insurance /mo", align: "right" as const, numeric: true, className: "hidden lg:table-cell" },
  { key: "taxes", label: "Taxes /mo", align: "right" as const, numeric: true, className: "hidden lg:table-cell" },
  { key: "expenses", label: "Expenses", align: "right" as const, numeric: true, className: "" },
  { key: "net", label: "Net", align: "right" as const, numeric: true, className: "" },
];

/** Sort values for one property row (money as String(cents) per convention). */
function netRowSortValues(r: PropertyFinancialRow): (string | number)[] {
  return [
    r.propertyName,
    r.activeLeases,
    String(r.expectedMonthlyCents),
    String(r.collectedMonthCents),
    String(r.mortgageMonthlyCents),
    String(r.insuranceMonthlyCents),
    String(r.taxesMonthlyCents),
    String(r.expensesMonthCents),
    String(r.netMonthCents),
  ];
}

/** The 9 rendered cells for one property row (currency-aware). */
function netRowCells(r: PropertyFinancialRow): React.ReactNode[] {
  return [
    <Link
      key="p"
      href={`/properties/${r.propertyId}`}
      className="font-medium hover:underline"
    >
      {r.propertyName}
    </Link>,
    r.activeLeases,
    <span key="e" className="tabular-nums">{formatCurrency(r.expectedMonthlyCents, r.currency)}</span>,
    <span key="c" className="tabular-nums">{formatCurrency(r.collectedMonthCents, r.currency)}</span>,
    <span key="m" className="tabular-nums">{formatCurrency(r.mortgageMonthlyCents, r.currency)}</span>,
    <span key="i" className="tabular-nums">{formatCurrency(r.insuranceMonthlyCents, r.currency)}</span>,
    <span key="t" className="tabular-nums">{formatCurrency(r.taxesMonthlyCents, r.currency)}</span>,
    <span key="x" className="tabular-nums">{formatCurrency(r.expensesMonthCents, r.currency)}</span>,
    <span key="n" className={cn("font-medium tabular-nums", netClass(r.netMonthCents))}>
      {formatCurrency(r.netMonthCents, r.currency)}
    </span>,
  ];
}

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("financials.view");
  const { actingRole } = await getDisplayRole();
  const settings = await getAppSettings();
  if (!settings.modules.financials) redirect("/dashboard");
  const canManage = hasCapability(
    actingRole,
    "financials.manage",
    settings.rolePermissions,
  );

  const sp = await searchParams;
  const first = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const filterPropertyId = first("propertyId") || undefined;
  const filterCategoryRaw = first("category");
  const filterCategory = (CATEGORIES as readonly string[]).includes(filterCategoryRaw)
    ? (filterCategoryRaw as ExpenseCategory)
    : undefined;

  const now = new Date();
  const expenseWhere: Prisma.PropertyExpenseWhereInput = {};
  if (filterPropertyId) expenseWhere.propertyId = filterPropertyId;
  if (filterCategory) expenseWhere.category = filterCategory;

  const [summary, expenses, properties, units, leases, vendors] = await Promise.all([
    getFinancialSummary(now),
    prisma.propertyExpense.findMany({
      where: expenseWhere,
      orderBy: { incurredOn: "desc" },
      take: 200,
      include: {
        property: { select: { id: true, name: true, currency: true } },
        unit: { select: { unitNumber: true } },
        lease: {
          include: { tenant: { select: { id: true, firstName: true, lastName: true } } },
        },
        vendor: { select: { name: true } },
      },
    }),
    prisma.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.unit.findMany({
      orderBy: [{ property: { name: "asc" } }, { unitNumber: "asc" }],
      select: { id: true, unitNumber: true, property: { select: { name: true } } },
    }),
    prisma.lease.findMany({
      where: { status: { in: ["active", "month_to_month"] } },
      include: {
        tenant: { select: { firstName: true, lastName: true } },
        unit: { select: { unitNumber: true, property: { select: { name: true } } } },
      },
      orderBy: { startDate: "desc" },
    }),
    settings.modules.vendors ? listActiveVendors() : Promise.resolve([]),
  ]);

  const t = summary.totals;
  // Portfolio module: group the per-property rows by legal entity (subtotaled
  // groups + a grand total). Off → the flat DataTable renders exactly as before.
  const portfolio = settings.modules.portfolio
    ? groupByEntity(summary.rows)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Financials"
        description="Cash-basis month-to-date: net = collected − mortgage − insurance − taxes − expenses (yearly insurance/taxes spread as /12 monthly). The tenant ledger stays the source of truth for tenant balances."
        actions={
          canManage && (
          <FormDialog
            trigger="Log expense"
            triggerVariant="default"
            title="Log expense"
            action={createExpenseAction}
            submitLabel="Log expense"
          >
            <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="exCategory">Category</Label>
                  <select
                    id="exCategory"
                    name="category"
                    required
                    className="h-9 w-full rounded-md border px-3 text-sm capitalize"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="exAmount">Amount</Label>
                  <Input
                    id="exAmount"
                    name="amount"
                    inputMode="decimal"
                    placeholder="120.00"
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exDate">Date</Label>
                <Input id="exDate" name="incurredOn" type="date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="exProperty">Property</Label>
                <select
                  id="exProperty"
                  name="propertyId"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— select —</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exUnit">Unit (optional — overrides property)</Label>
                <select
                  id="exUnit"
                  name="unitId"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— none —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.property.name} · {u.unitNumber}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exLease">
                  Tenant lease (optional — e.g. utilities paid for a tenant)
                </Label>
                <select
                  id="exLease"
                  name="leaseId"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— none —</option>
                  {leases.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.tenant.lastName}, {l.tenant.firstName} — {l.unit.property.name} ·{" "}
                      {l.unit.unitNumber}
                    </option>
                  ))}
                </select>
              </div>
            {settings.modules.vendors && vendors.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="exVendor">Vendor (optional)</Label>
                <select
                  id="exVendor"
                  name="vendorId"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— none —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="exDesc">Description</Label>
              <Input id="exDesc" name="description" placeholder="June water bill" />
            </div>
          </FormDialog>
          )
        }
      />

      <Card className="border-t-4 border-t-emerald-500">
        <CardHeader>
          <CardTitle>Net income by property (this month)</CardTitle>
        </CardHeader>
        <CardContent>
          {portfolio ? (
            <EntityGroupedNetIncome groups={portfolio.groups} grandTotal={portfolio.grandTotal} />
          ) : (
            <DataTable
              emptyMessage="No properties yet."
              columns={NET_INCOME_COLUMNS}
              rows={summary.rows.map((r) => ({
                key: r.propertyId,
                sortValues: netRowSortValues(r),
                cells: netRowCells(r),
              }))}
            />
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            Portfolio: expected{" "}
            <span className="tabular-nums">{formatCurrency(t.expectedMonthlyCents)}</span>/mo ·
            collected <span className="tabular-nums">{formatCurrency(t.collectedMonthCents)}</span> ·
            mortgage <span className="tabular-nums">{formatCurrency(t.mortgageMonthlyCents)}</span>/mo ·
            insurance <span className="tabular-nums">{formatCurrency(t.insuranceMonthlyCents)}</span>/mo ·
            taxes <span className="tabular-nums">{formatCurrency(t.taxesMonthlyCents)}</span>/mo ·
            expenses <span className="tabular-nums">{formatCurrency(t.expensesMonthCents)}</span> · net{" "}
            <span className={cn("font-medium tabular-nums", netClass(t.netMonthCents))}>
              {formatCurrency(t.netMonthCents)}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-indigo-500">
        <CardHeader>
          <CardTitle>Mortgages & payoff projection</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.mortgages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No property mortgages entered. Add the monthly payment and maturity
              date on a property&apos;s page (Edit property).
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {summary.mortgages.map((m) => (
                <li key={m.propertyId} className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    href={`/properties/${m.propertyId}`}
                    className="font-medium hover:underline"
                  >
                    {m.propertyName}
                  </Link>
                  <span className="tabular-nums">
                    {formatCurrency(m.monthlyCents)}/mo
                  </span>
                  {m.matured ? (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      — matured{" "}
                      {m.maturityDate?.toLocaleDateString("en-US", { timeZone: "UTC" })}; no
                      longer counted against net
                    </span>
                  ) : m.maturityDate ? (
                    <span className="text-muted-foreground">
                      — matures{" "}
                      {m.maturityDate.toLocaleDateString("en-US", { timeZone: "UTC" })}
                      {" → "}
                      <span className="text-emerald-700 dark:text-emerald-400">
                        +{formatCurrency(m.monthlyCents)}/mo to net after payoff
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">— no maturity date set</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-amber-500">
        <CardHeader>
          <CardTitle>Expense log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="fProperty">Property</Label>
              <select
                id="fProperty"
                name="propertyId"
                defaultValue={filterPropertyId ?? ""}
                className="h-9 w-48 rounded-md border px-3 text-sm"
              >
                <option value="">All properties</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fCategory">Category</Label>
              <select
                id="fCategory"
                name="category"
                defaultValue={filterCategory ?? ""}
                className="h-9 w-40 rounded-md border px-3 text-sm capitalize"
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {(filterPropertyId || filterCategory) && (
              <Button variant="ghost" size="sm" render={<Link href="/financials" />}>
                Clear
              </Button>
            )}
          </form>

          <DataTable
            emptyMessage="No expenses logged yet."
            columns={[
              { key: "date", label: "Date" },
              { key: "property", label: "Property" },
              { key: "unit", label: "Unit", className: "hidden sm:table-cell" },
              { key: "tenant", label: "Tenant", className: "hidden lg:table-cell" },
              { key: "category", label: "Category" },
              { key: "description", label: "Description", sortable: false, className: "hidden md:table-cell" },
              { key: "amount", label: "Amount", align: "right", numeric: true },
              ...(canManage
                ? [{ key: "actions", label: "", align: "right" as const, sortable: false }]
                : []),
            ]}
            rows={expenses.map((e) => ({
              key: e.id,
              sortValues: [
                e.incurredOn.toISOString(),
                e.property.name,
                e.unit?.unitNumber ?? null,
                e.lease ? `${e.lease.tenant.lastName}, ${e.lease.tenant.firstName}` : null,
                e.category,
                null,
                String(e.amountCents),
                ...(canManage ? [null] : []),
              ],
              cells: [
                e.incurredOn.toLocaleDateString("en-US", { timeZone: "UTC" }),
                <Link
                  key="p"
                  href={`/properties/${e.property.id}`}
                  className="hover:underline"
                >
                  {e.property.name}
                </Link>,
                e.unit?.unitNumber ?? "—",
                e.lease ? (
                  <Link
                    key="t"
                    href={`/tenants/${e.lease.tenant.id}`}
                    className="hover:underline"
                  >
                    {e.lease.tenant.firstName} {e.lease.tenant.lastName}
                  </Link>
                ) : (
                  "—"
                ),
                <span key="c" className="capitalize">
                  {e.category}
                </span>,
                <span key="d" className="text-muted-foreground">
                  {e.description ?? ""}
                  {e.vendor && (
                    <span className="block text-xs">Vendor: {e.vendor.name}</span>
                  )}
                </span>,
                <span key="a" className="tabular-nums">
                  {formatCurrency(e.amountCents, e.property.currency)}
                </span>,
                ...(canManage
                  ? [
                      <form key="x" action={deleteExpenseAction} className="inline">
                        <input type="hidden" name="expenseId" value={e.id} />
                        <ConfirmSubmitButton
                          confirmMessage="Delete this expense record? This cannot be undone."
                          variant="outline"
                          size="xs"
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </form>,
                    ]
                  : []),
              ],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}

/** A subtotal/grand-total row's money cells, in NET_INCOME_COLUMNS order and
 *  honoring each column's responsive hiding so they line up with property rows.
 *  Aggregates display in the org default currency (groups may mix currencies). */
function subtotalCells(s: PortfolioSubtotal, emphasizeNet: boolean): React.ReactNode {
  const cols: { value: bigint; className?: string }[] = [
    { value: s.expectedMonthlyCents, className: "hidden md:table-cell" },
    { value: s.collectedMonthCents },
    { value: s.mortgageMonthlyCents },
    { value: s.insuranceMonthlyCents, className: "hidden lg:table-cell" },
    { value: s.taxesMonthlyCents, className: "hidden lg:table-cell" },
    { value: s.expensesMonthCents },
  ];
  return (
    <>
      {/* Leases column (no subtotal) — hidden on small screens, like the header. */}
      <TableCell className="hidden text-right sm:table-cell" />
      {cols.map((c, i) => (
        <TableCell key={i} className={cn("text-right tabular-nums", c.className)}>
          {formatCurrency(c.value)}
        </TableCell>
      ))}
      <TableCell
        className={cn(
          "text-right font-medium tabular-nums",
          netClass(s.netMonthCents),
          !emphasizeNet && "font-normal",
        )}
      >
        {formatCurrency(s.netMonthCents)}
      </TableCell>
    </>
  );
}

/**
 * Net-income table grouped by legal entity (Portfolio module): each entity is a
 * header row + its property rows + a subtotal row, followed by a portfolio
 * grand-total row. Property rows reuse {@link netRowCells} so the figures match
 * the flat (module-off) table exactly.
 */
function EntityGroupedNetIncome({
  groups,
  grandTotal,
}: {
  groups: PortfolioGroup<PropertyFinancialRow>[];
  grandTotal: PortfolioSubtotal;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60 hover:bg-muted/60">
            {NET_INCOME_COLUMNS.map((c) => (
              <TableHead
                key={c.key}
                className={cn(c.align === "right" && "text-right", c.className)}
              >
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={NET_INCOME_COLUMNS.length}
                className="py-6 text-center text-muted-foreground"
              >
                No properties yet.
              </TableCell>
            </TableRow>
          )}
          {groups.map((g) => (
            <Fragment key={g.entity}>
              <TableRow className="border-l-2 border-l-sky-500 bg-sky-50/60 hover:bg-sky-50/60 dark:bg-sky-950/20 dark:hover:bg-sky-950/20">
                <TableCell
                  colSpan={NET_INCOME_COLUMNS.length}
                  className="whitespace-normal font-semibold"
                >
                  {g.entity}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {g.rows.length} propert{g.rows.length === 1 ? "y" : "ies"}
                  </span>
                </TableCell>
              </TableRow>
              {g.rows.map((r) => {
                const cells = netRowCells(r);
                return (
                  <TableRow key={r.propertyId}>
                    {cells.map((cell, i) => (
                      <TableCell
                        key={NET_INCOME_COLUMNS[i].key}
                        className={cn(
                          NET_INCOME_COLUMNS[i].align === "right" && "text-right",
                          NET_INCOME_COLUMNS[i].className,
                        )}
                      >
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableCell className="font-medium">{g.entity} subtotal</TableCell>
                {subtotalCells(g.subtotal, false)}
              </TableRow>
            </Fragment>
          ))}
          {groups.length > 0 && (
            <TableRow className="border-t-2 bg-muted/60 hover:bg-muted/60">
              <TableCell className="font-semibold">Portfolio total</TableCell>
              {subtotalCells(grandTotal, true)}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
