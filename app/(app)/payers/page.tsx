import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { PAYER_TYPES, payerTypeLabel } from "@/lib/payers/payer-type";
import type { PayerType } from "@/lib/generated/prisma/enums";
import { formatCurrency } from "@/lib/money";
import { getSubsidyExpectations } from "@/lib/services/rent-shares";
import {
  createPayerAction,
  invitePayerPortalAction,
  setPayerActiveAction,
  setPayerPortalActiveAction,
  updatePayerAction,
} from "./actions";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export const runtime = "nodejs";

interface PayerDefaults {
  id: string;
  name: string;
  type: PayerType;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  mailingAddress: string | null;
  notes: string | null;
}

/** Shared add/edit fields. `defaults` (edit) prefill values + a hidden id. */
function PayerFields({ defaults }: { defaults?: PayerDefaults }) {
  const k = defaults?.id ?? "new";
  return (
    <>
      {defaults && <input type="hidden" name="payerId" value={defaults.id} />}
      <div className="space-y-2">
        <Label htmlFor={`name-${k}`}>Name</Label>
        <Input
          id={`name-${k}`}
          name="name"
          required
          defaultValue={defaults?.name}
          placeholder="Metro Housing Authority"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`type-${k}`}>Type</Label>
        <select
          id={`type-${k}`}
          name="type"
          defaultValue={defaults?.type ?? "housing_authority"}
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          {PAYER_TYPES.map((t) => (
            <option key={t} value={t}>
              {payerTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`contact-${k}`}>Contact name</Label>
          <Input id={`contact-${k}`} name="contactName" defaultValue={defaults?.contactName ?? ""} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`phone-${k}`}>Phone</Label>
          <Input id={`phone-${k}`} name="phone" defaultValue={defaults?.phone ?? ""} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`email-${k}`}>Email</Label>
        <Input id={`email-${k}`} name="email" type="email" defaultValue={defaults?.email ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`addr-${k}`}>Mailing address</Label>
        <Input id={`addr-${k}`} name="mailingAddress" defaultValue={defaults?.mailingAddress ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`notes-${k}`}>Notes</Label>
        <Textarea id={`notes-${k}`} name="notes" defaultValue={defaults?.notes ?? ""} />
      </div>
    </>
  );
}

export default async function PayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("payers.manage");
  const sp = await searchParams;
  const first = (k: string): string => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const portalLink = first("portalLink");
  const portalSent = first("portalSent");
  const portalError = first("portalError");

  const [payers, expectations] = await Promise.all([
    prisma.payer.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: {
        _count: { select: { payments: true } },
        portalAccount: { select: { isActive: true, passwordHash: true } },
      },
    }),
    getSubsidyExpectations(new Date()),
  ]);

  // Missing first (largest shortfall), then the rest, for the tracker table.
  const tracker = [...expectations].sort(
    (a, b) => Number(b.missingCents - a.missingCents),
  );
  const missingRows = tracker.filter((r) => r.missingCents > 0n);
  const totalMissingCents = missingRows.reduce((s, r) => s + r.missingCents, 0n);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payers</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Third parties who pay on a tenant&apos;s behalf — e.g. a HUD/Section 8
            housing authority paying the subsidy (HAP) portion of rent. Recording
            a payment, pick the payer under &ldquo;Paid by.&rdquo; Payers are an
            attribution directory only; they never affect tenant balances.
          </p>
        </div>
        <FormDialog
          trigger="Add payer"
          triggerVariant="default"
          title="Add payer"
          action={createPayerAction}
          submitLabel="Add payer"
        >
          <PayerFields />
        </FormDialog>
      </div>

      {portalError && (
        <Alert variant="destructive">
          <AlertDescription>{portalError}</AlertDescription>
        </Alert>
      )}
      {portalSent && (
        <Alert>
          <AlertDescription>Portal invite emailed.</AlertDescription>
        </Alert>
      )}
      {portalLink && (
        <Alert>
          <AlertDescription>
            Invite created, but email isn&apos;t configured — share this single-use
            link (expires in 7 days):{" "}
            <span className="font-mono break-all">{portalLink}</span>
          </AlertDescription>
        </Alert>
      )}

      {tracker.length > 0 && (
        <Card
          className={`border-t-4 ${
            totalMissingCents > 0n ? "border-t-red-500" : "border-t-emerald-500"
          }`}
        >
          <CardHeader>
            <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
              <span>Expected subsidy payments (this month)</span>
              {totalMissingCents > 0n ? (
                <span className="text-sm font-normal text-red-600 dark:text-red-400">
                  {formatCurrency(totalMissingCents)} not yet received
                </span>
              ) : (
                <span className="text-sm font-normal text-emerald-600 dark:text-emerald-400">
                  All expected payments received
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DataTable
              emptyMessage="No subsidized leases yet."
              columns={[
                { key: "tenant", label: "Tenant" },
                { key: "unit", label: "Unit", className: "hidden sm:table-cell" },
                { key: "payer", label: "Expected from" },
                { key: "expected", label: "Expected", align: "right", numeric: true },
                { key: "received", label: "Received", align: "right", numeric: true, className: "hidden md:table-cell" },
                { key: "missing", label: "Missing", align: "right", numeric: true },
              ]}
              rows={tracker.map((r) => ({
                key: `${r.leaseId}:${r.payerId ?? "tenant"}`,
                sortValues: [
                  r.tenantName,
                  `${r.propertyName} · ${r.unitLabel}`,
                  r.payerName,
                  String(r.expectedCents),
                  String(r.receivedCents),
                  String(r.missingCents),
                ],
                cells: [
                  <Link
                    key="t"
                    href={`/tenants/${r.tenantId}`}
                    className="font-medium hover:underline"
                  >
                    {r.tenantName}
                  </Link>,
                  `${r.propertyName} · ${r.unitLabel}`,
                  <span key="p" className={r.payerId ? "" : "text-muted-foreground"}>
                    {r.payerName}
                  </span>,
                  <span key="e" className="tabular-nums">
                    {formatCurrency(r.expectedCents, r.currency)}
                  </span>,
                  <span key="r" className="tabular-nums">
                    {formatCurrency(r.receivedCents, r.currency)}
                  </span>,
                  <span
                    key="m"
                    className={`tabular-nums ${
                      r.missingCents > 0n
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                    }`}
                  >
                    {r.missingCents > 0n ? formatCurrency(r.missingCents, r.currency) : "—"}
                  </span>,
                ],
              }))}
            />
            <p className="text-xs text-muted-foreground">
              &ldquo;Received&rdquo; is this month&apos;s posted payments attributed
              to each payer. Set a lease&apos;s split on the tenant&apos;s page.
              This is an expectation overlay — tenant balances always come from
              the ledger.
            </p>
          </CardContent>
        </Card>
      )}

      <h2 className="text-lg font-semibold">Payer directory</h2>
      <DataTable
        emptyMessage="No payers yet. Add a housing authority or other third-party payer."
        columns={[
          { key: "name", label: "Name" },
          { key: "type", label: "Type" },
          { key: "contact", label: "Contact", sortable: false, className: "hidden md:table-cell" },
          { key: "payments", label: "Payments", align: "right", numeric: true, className: "hidden sm:table-cell" },
          { key: "status", label: "Status" },
          { key: "portal", label: "Portal", sortable: false, className: "hidden lg:table-cell" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={payers.map((p) => {
          const acct = p.portalAccount;
          const portalStatus = !acct
            ? "Not invited"
            : !acct.passwordHash
              ? "Invited"
              : !acct.isActive
                ? "Disabled"
                : "Active";
          return {
          key: p.id,
          sortValues: [
            p.name,
            payerTypeLabel(p.type),
            null,
            p._count.payments,
            p.isActive ? "active" : "inactive",
            null,
            null,
          ],
          cells: [
            <span key="n" className={p.isActive ? "font-medium" : "font-medium text-muted-foreground"}>
              {p.name}
            </span>,
            payerTypeLabel(p.type),
            <span key="c" className="text-sm text-muted-foreground">
              {p.contactName && <div>{p.contactName}</div>}
              {p.email && <div>{p.email}</div>}
              {p.phone && <div>{p.phone}</div>}
              {!p.contactName && !p.email && !p.phone && "—"}
            </span>,
            p._count.payments,
            p.isActive ? (
              <span key="s" className="text-emerald-600 dark:text-emerald-400">Active</span>
            ) : (
              <span key="s" className="text-muted-foreground">Inactive</span>
            ),
            <div key="portal" className="flex flex-col items-start gap-1">
              <span
                className={
                  acct?.isActive && acct?.passwordHash
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                }
              >
                {portalStatus}
              </span>
              <div className="flex gap-2">
                <form action={invitePayerPortalAction}>
                  <input type="hidden" name="payerId" value={p.id} />
                  <Button type="submit" variant="outline" size="xs">
                    {acct ? "Resend" : "Invite"}
                  </Button>
                </form>
                {acct && (
                  <form action={setPayerPortalActiveAction}>
                    <input type="hidden" name="payerId" value={p.id} />
                    <input
                      type="hidden"
                      name="isActive"
                      value={acct.isActive ? "false" : "true"}
                    />
                    <Button type="submit" variant="outline" size="xs">
                      {acct.isActive ? "Disable" : "Enable"}
                    </Button>
                  </form>
                )}
              </div>
            </div>,
            <div key="a" className="flex justify-end gap-2">
              <FormDialog
                trigger="Edit"
                title={`Edit ${p.name}`}
                action={updatePayerAction}
                submitLabel="Save"
              >
                <PayerFields
                  defaults={{
                    id: p.id,
                    name: p.name,
                    type: p.type,
                    contactName: p.contactName,
                    email: p.email,
                    phone: p.phone,
                    mailingAddress: p.mailingAddress,
                    notes: p.notes,
                  }}
                />
              </FormDialog>
              <form action={setPayerActiveAction}>
                <input type="hidden" name="payerId" value={p.id} />
                <input type="hidden" name="isActive" value={p.isActive ? "false" : "true"} />
                <Button type="submit" variant="outline" size="sm">
                  {p.isActive ? "Deactivate" : "Reactivate"}
                </Button>
              </form>
            </div>,
          ],
          };
        })}
      />
    </div>
  );
}
