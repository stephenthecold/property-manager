"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  applyChargeTermsToActiveLeases,
  saveBillingDefaultsAction,
  savePaymentMethodsAction,
  type BillingState,
} from "./actions";

/** Money crosses the RSC→client boundary as plain decimal strings. */
export interface BillingDefaultsInitial {
  dueDay: number;
  graceDays: number;
  lateFeeType: string;
  lateFeeAmount: string;
  lateFeeBps: number | null;
  lateFeeMax: string;
  internetFee: string;
}

function StateAlerts({ state }: { state: BillingState }) {
  return (
    <>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

export function BillingDefaultsForm({ initial }: { initial: BillingDefaultsInitial }) {
  const [state, formAction, pending] = useActionState<BillingState, FormData>(
    saveBillingDefaultsAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <StateAlerts state={state} />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="dueDay">Rent due day (1–31)</Label>
          <Input
            id="dueDay"
            name="dueDay"
            type="number"
            min={1}
            max={31}
            defaultValue={initial.dueDay}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="graceDays">Grace period (days)</Label>
          <Input
            id="graceDays"
            name="graceDays"
            type="number"
            min={0}
            max={60}
            defaultValue={initial.graceDays}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="lateFeeType">Late fee type</Label>
          <select
            id="lateFeeType"
            name="lateFeeType"
            defaultValue={initial.lateFeeType}
            className="h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="none">None</option>
            <option value="fixed">Fixed (one-time)</option>
            <option value="percentage">Percentage (one-time)</option>
            <option value="daily">Per day past grace</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="lateFeeAmount">Amount ($ fixed / $ per day)</Label>
          <Input
            id="lateFeeAmount"
            name="lateFeeAmount"
            inputMode="decimal"
            placeholder="10.00"
            defaultValue={initial.lateFeeAmount}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lateFeeBps">Percent (bps)</Label>
          <Input
            id="lateFeeBps"
            name="lateFeeBps"
            type="number"
            min={0}
            max={10000}
            placeholder="500 = 5%"
            defaultValue={initial.lateFeeBps ?? ""}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lateFeeMax">Daily cap per period</Label>
          <Input
            id="lateFeeMax"
            name="lateFeeMax"
            inputMode="decimal"
            placeholder="optional"
            defaultValue={initial.lateFeeMax}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="internetFee">Default internet fee (new units)</Label>
        <Input
          id="internetFee"
          name="internetFee"
          inputMode="decimal"
          defaultValue={initial.internetFee}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        For a percentage late fee, the base is the full monthly charge (rent
        plus internet add-on); 500 bps = 5%. &ldquo;Per day past grace&rdquo;
        accrues the amount daily once the grace period ends (e.g. $10/day after
        the first 5 days), until paid or the optional cap is reached.
      </p>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save defaults"}
      </Button>
    </form>
  );
}

export function ApplyTermsForm({ activeLeases }: { activeLeases: number }) {
  const [state, formAction, pending] = useActionState<BillingState, FormData>(
    applyChargeTermsToActiveLeases,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <StateAlerts state={state} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Overwrites the grace period and late-fee terms on all{" "}
          <span className="font-medium text-foreground">{activeLeases}</span>{" "}
          active lease{activeLeases === 1 ? "" : "s"} with the saved defaults
          above (audited per lease). The due day is never bulk-changed — adjust
          that per lease.
        </p>
        {pending ? (
          <Button size="sm" variant="destructive" disabled>
            Applying…
          </Button>
        ) : (
          <ConfirmSubmitButton
            confirmMessage={`Overwrite grace + late-fee terms on ${activeLeases} active lease(s) with the saved defaults? This is audited per lease.`}
          >
            Apply to {activeLeases} lease{activeLeases === 1 ? "" : "s"}
          </ConfirmSubmitButton>
        )}
      </div>
    </form>
  );
}

export interface PaymentMethodsInitial {
  cashtag: string;
  /** Which offline methods the tenant portal offers as self-report options. */
  cashApp: boolean;
  cash: boolean;
  ach: boolean;
}

export function PaymentMethodsForm({ initial }: { initial: PaymentMethodsInitial }) {
  const [state, formAction, pending] = useActionState<BillingState, FormData>(
    savePaymentMethodsAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <StateAlerts state={state} />
      <div className="space-y-2">
        <Label htmlFor="cashAppCashtag">Cash App cashtag</Label>
        <Input
          id="cashAppCashtag"
          name="cashAppCashtag"
          defaultValue={initial.cashtag}
          placeholder="$YourBusiness"
          maxLength={21}
        />
        <p className="text-xs text-muted-foreground">
          Shown to tenants as a way to pay: use {"{{cash_app_tag}}"} or{" "}
          {"{{cash_app_link}}"} in reminder templates (Settings → Messaging) and
          it appears in the tenant portal&apos;s payment panel. Cash App has no
          API — record incoming payments manually with the “cash app” method and
          the transaction reference. Leave blank to disable.
        </p>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">Tenant portal self-report options</div>
        <p className="text-xs text-muted-foreground">
          Which offline methods tenants can report paying from the portal (the
          Tenant payments module must be on). A self-report is recorded as
          pending and only changes a balance once you confirm it under Payments →
          “pending self-reports”.
        </p>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="methodCashApp"
            defaultChecked={initial.cashApp}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>Cash App (needs a cashtag above)</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="methodCash"
            defaultChecked={initial.cash}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>Cash</span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="methodAch"
            defaultChecked={initial.ach}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Bank transfer / ACH (also enables Stripe ACH bank debit at online
            checkout when a Stripe gateway is configured)
          </span>
        </label>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save payment methods"}
      </Button>
    </form>
  );
}
