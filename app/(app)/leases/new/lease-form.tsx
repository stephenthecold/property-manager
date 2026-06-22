"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { createLease, type CreateLeaseState } from "../actions";
import { UTILITY_OPTIONS } from "@/lib/config/lease";
import { LeaseInternetFields } from "@/components/app/lease-internet-fields";
import { NewTenantInlineDialog } from "@/components/app/new-tenant-inline-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Money crosses the RSC→client boundary as plain decimal strings. */
export interface TenantOption {
  id: string;
  label: string;
}
export interface UnitOption {
  id: string;
  label: string;
}
export interface LeaseFormDefaults {
  dueDay: number;
  graceDays: number;
  lateFeeType: string;
  /** Prefill for the late-fee field ($ for fixed/daily, bps for percentage). */
  lateFeeValue: string;
  lateFeeMax: string;
  /** Org-wide internet fee, used when the selected unit has no default. */
  internetFallbackFee: string;
}

interface DepositRowDraft {
  key: number;
  label: string;
  amount: string;
  nonRefundable: boolean;
}

export function LeaseForm({
  tenants,
  units,
  unitInternetDefaults,
  defaults,
  preselectTenantId,
}: {
  /** Active tenants NOT already on an active/month-to-month lease. */
  tenants: TenantOption[];
  /** Vacant units. */
  units: UnitOption[];
  unitInternetDefaults: Record<string, { enabled: boolean; fee: string }>;
  defaults: LeaseFormDefaults;
  preselectTenantId?: string;
}) {
  const [state, formAction, pending] = useActionState<CreateLeaseState, FormData>(
    createLease,
    {},
  );

  // Primary tenant is tracked in state so the co-tenant picker can exclude it live.
  const [primaryId, setPrimaryId] = useState(
    preselectTenantId && tenants.some((t) => t.id === preselectTenantId)
      ? preselectTenantId
      : "",
  );
  const [coTenantIds, setCoTenantIds] = useState<string[]>([]);
  const [coFilter, setCoFilter] = useState("");
  // Lifted into state so a tenant created inline (below) can be appended and
  // auto-selected without a full page reload.
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>(tenants);

  const tenantLabel = useMemo(
    () => new Map(tenantOptions.map((t) => [t.id, t.label])),
    [tenantOptions],
  );
  const coTenantChoices = useMemo(() => {
    const q = coFilter.trim().toLowerCase();
    return tenantOptions.filter(
      (t) => t.id !== primaryId && (!q || t.label.toLowerCase().includes(q)),
    );
  }, [tenantOptions, primaryId, coFilter]);

  function handlePrimaryChange(id: string) {
    setPrimaryId(id);
    // The primary tenant can never also be a co-tenant.
    setCoTenantIds((ids) => ids.filter((c) => c !== id));
  }
  function handleTenantCreated(t: TenantOption) {
    setTenantOptions((opts) =>
      opts.some((o) => o.id === t.id)
        ? opts
        : [...opts, t].sort((a, b) => a.label.localeCompare(b.label)),
    );
    setPrimaryId(t.id);
  }
  function toggleCoTenant(id: string) {
    setCoTenantIds((ids) =>
      ids.includes(id) ? ids.filter((c) => c !== id) : [...ids, id],
    );
  }

  // Additional deposits: dynamic rows serialized into ONE hidden field.
  const depositKey = useRef(0);
  const [depositRows, setDepositRows] = useState<DepositRowDraft[]>([]);
  const depositsJson = JSON.stringify(
    depositRows
      .filter((r) => r.label.trim() !== "" || r.amount.trim() !== "")
      .map(({ label, amount, nonRefundable }) => ({ label, amount, nonRefundable })),
  );
  function addDepositRow() {
    depositKey.current += 1;
    setDepositRows((rows) => [
      ...rows,
      { key: depositKey.current, label: "", amount: "", nonRefundable: false },
    ]);
  }
  function updateDepositRow(key: number, patch: Partial<DepositRowDraft>) {
    setDepositRows((rows) =>
      rows.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
  }
  function removeDepositRow(key: number) {
    setDepositRows((rows) => rows.filter((r) => r.key !== key));
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="tenantId">Tenant</Label>
        <div className="flex items-center gap-2">
          <select
            id="tenantId"
            name="tenantId"
            value={primaryId}
            onChange={(e) => handlePrimaryChange(e.target.value)}
            required
            className="h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="" disabled>
              Select tenant…
            </option>
            {tenantOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <NewTenantInlineDialog onCreated={handleTenantCreated} />
        </div>
        <p className="text-xs text-muted-foreground">
          Tenants already on an active lease aren&apos;t shown — or add a new one.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="unitId">Unit (vacant)</Label>
        <select
          id="unitId"
          name="unitId"
          required
          defaultValue=""
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="" disabled>
            Select unit…
          </option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="coTenantFilter">Co-tenants (optional)</Label>
        {coTenantIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {coTenantIds.map((id) => (
              <Badge key={id} variant="secondary" className="gap-1 pr-1">
                {tenantLabel.get(id) ?? id}
                <button
                  type="button"
                  aria-label={`Remove ${tenantLabel.get(id) ?? "co-tenant"}`}
                  onClick={() => toggleCoTenant(id)}
                  className="rounded-full px-0.5 leading-none hover:text-destructive"
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
        )}
        {coTenantIds.map((id) => (
          <input key={id} type="hidden" name="coTenants" value={id} />
        ))}
        <Input
          id="coTenantFilter"
          value={coFilter}
          onChange={(e) => setCoFilter(e.target.value)}
          placeholder="Filter tenants…"
          autoComplete="off"
        />
        <div className="max-h-44 overflow-y-auto rounded-md border">
          {coTenantChoices.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {coFilter.trim()
                ? "No available tenants match."
                : "No other tenants are available."}
            </p>
          ) : (
            coTenantChoices.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={coTenantIds.includes(t.id)}
                  onChange={() => toggleCoTenant(t.id)}
                  className="size-4 accent-primary"
                />
                {t.label}
              </label>
            ))
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Tenants already on an active lease aren&apos;t shown; the primary
          tenant is excluded automatically.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="rentAmount">Monthly rent</Label>
          <Input
            id="rentAmount"
            name="rentAmount"
            inputMode="decimal"
            placeholder="1200.00"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dueDay">Due day (1–31)</Label>
          <Input
            id="dueDay"
            name="dueDay"
            type="number"
            min={1}
            max={31}
            defaultValue={defaults.dueDay}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End date (optional)</Label>
          <Input id="endDate" name="endDate" type="date" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="gracePeriodDays">Grace period (days)</Label>
          <Input
            id="gracePeriodDays"
            name="gracePeriodDays"
            type="number"
            min={0}
            defaultValue={defaults.graceDays}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lateFeeType">Late fee type</Label>
          <select
            id="lateFeeType"
            name="lateFeeType"
            className="h-9 w-full rounded-md border px-3 text-sm"
            defaultValue={defaults.lateFeeType}
          >
            <option value="none">None</option>
            <option value="fixed">Fixed (one-time)</option>
            <option value="percentage">Percentage (one-time)</option>
            <option value="daily">Per day past grace</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="lateFeeAmount">Late fee ($ fixed / $ per day / % bps)</Label>
          <Input
            id="lateFeeAmount"
            name="lateFeeAmount"
            placeholder="50.00"
            defaultValue={defaults.lateFeeValue}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lateFeeMax">Daily cap per period (optional)</Label>
          <Input
            id="lateFeeMax"
            name="lateFeeMax"
            inputMode="decimal"
            placeholder="100.00"
            defaultValue={defaults.lateFeeMax}
          />
        </div>
      </div>

      <LeaseInternetFields
        unitDefaults={unitInternetDefaults}
        fallbackFee={defaults.internetFallbackFee}
      />

      <div className="rounded-md border p-3 space-y-2">
        <p className="text-sm font-medium">Utilities we pay (informational)</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm capitalize">
          {UTILITY_OPTIONS.map((u) => (
            <label key={u} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                name="utilities"
                value={u}
                className="size-4 accent-primary"
              />
              {u}
            </label>
          ))}
        </div>
        <Input name="utilitiesNotes" placeholder="Utility notes (optional)" />
      </div>

      <div className="flex items-center gap-2">
        <input
          id="prorateFirstPeriod"
          name="prorateFirstPeriod"
          type="checkbox"
          defaultChecked
          className="size-4 accent-primary"
        />
        <Label htmlFor="prorateFirstPeriod">
          Prorate the move-in month (mid-month start bills only the days occupied)
        </Label>
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <p className="text-sm font-medium">Backdated lease? Billing &amp; opening balance</p>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="billingStart"
              value="start"
              defaultChecked
              className="accent-primary"
            />
            Bill every period since the start date (full history)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="billingStart"
              value="current"
              className="accent-primary"
            />
            Start billing at the next due date (importing an existing tenancy)
          </label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="openingBalance">Opening balance still owed (optional)</Label>
          <Input
            id="openingBalance"
            name="openingBalance"
            inputMode="decimal"
            placeholder="0.00"
            className="max-w-40"
          />
          <p className="text-xs text-muted-foreground">
            Only with &ldquo;next due date&rdquo; billing: posted as an
            opening-balance adjustment that payments pay off oldest-first.
            Include any rent already due this period; leave empty if the
            tenant is caught up.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="securityDeposit">Security deposit</Label>
          <Input id="securityDeposit" name="securityDeposit" inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            className="h-9 w-full rounded-md border px-3 text-sm"
            defaultValue="active"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="month_to_month">Month-to-month</option>
          </select>
        </div>
      </div>

      <div className="rounded-md border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Additional deposits (optional)</p>
          <Button type="button" variant="outline" size="sm" onClick={addDepositRow}>
            Add deposit
          </Button>
        </div>
        {depositRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Itemized deposits beyond the base security deposit — e.g. pet or key
            deposits — recorded with the lease.
          </p>
        ) : (
          <div className="space-y-2">
            {depositRows.map((row) => (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Deposit label"
                  placeholder="Label (e.g. Pet deposit)"
                  value={row.label}
                  onChange={(e) => updateDepositRow(row.key, { label: e.target.value })}
                  className="min-w-40 flex-1"
                />
                <Input
                  aria-label="Deposit amount"
                  inputMode="decimal"
                  placeholder="250.00"
                  value={row.amount}
                  onChange={(e) => updateDepositRow(row.key, { amount: e.target.value })}
                  className="w-28"
                />
                <label className="flex items-center gap-1.5 text-sm whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={row.nonRefundable}
                    onChange={(e) =>
                      updateDepositRow(row.key, { nonRefundable: e.target.checked })
                    }
                    className="size-4 accent-primary"
                  />
                  Non-refundable
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Remove deposit row"
                  onClick={() => removeDepositRow(row.key)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <input type="hidden" name="depositsJson" value={depositsJson} />
      </div>

      <p className="text-xs text-muted-foreground">
        For a percentage late fee, enter basis points in the late-fee field (e.g. 500 = 5%)
        and set type to Percentage.
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create lease"}
      </Button>
    </form>
  );
}
