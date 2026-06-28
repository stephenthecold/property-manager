"use client";

import { useActionState } from "react";
import { reportSelfPaymentAction, type SelfReportState } from "./actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** One selectable offline method for the self-report form. */
export interface SelfReportMethodOption {
  /** PaymentMethod enum value, e.g. "cash_app". */
  value: string;
  /** Human label, e.g. "Cash App". */
  label: string;
}

/**
 * Tenant self-reports an offline payment they already made. Submitting records a
 * PENDING payment (no ledger entry, balance unchanged) for staff to confirm. The
 * available methods are whatever the operator enabled in the portal method
 * config; the form is only rendered when the payments module is on and at least
 * one method is offered.
 */
export function SelfReportPaymentForm({
  leaseId,
  methods,
  defaultAmount,
}: {
  leaseId: string;
  methods: SelfReportMethodOption[];
  defaultAmount?: string;
}) {
  const [state, formAction, pending] = useActionState<SelfReportState, FormData>(
    reportSelfPaymentAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3 rounded-md border bg-card p-3">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">Already paid? Let us know</div>
        <p className="text-xs text-muted-foreground">
          Tell us about a payment you made by Cash App, cash, or bank transfer.
          We&apos;ll confirm it and update your balance — reporting it here does
          not charge you.
        </p>
      </div>
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
      <input type="hidden" name="leaseId" value={leaseId} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="self-report-method">How you paid</Label>
          <select
            id="self-report-method"
            name="method"
            defaultValue={methods[0]?.value ?? ""}
            className="h-9 w-40 rounded-md border px-3 text-sm"
          >
            {methods.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="self-report-amount">Amount</Label>
          <Input
            id="self-report-amount"
            name="amount"
            inputMode="decimal"
            defaultValue={defaultAmount}
            placeholder="0.00"
            className="w-32"
            required
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="self-report-ref">Reference (optional)</Label>
          <Input
            id="self-report-ref"
            name="referenceNumber"
            placeholder="Confirmation #"
            className="w-44"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Sending…" : "Report payment"}
        </Button>
      </div>
    </form>
  );
}
