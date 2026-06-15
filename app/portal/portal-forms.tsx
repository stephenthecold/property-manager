"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  requestCashPickupAction,
  savePaymentPreferenceAction,
  setSmsConsentAction,
  submitMaintenanceRequestAction,
  type PortalActionState,
} from "./actions";

function StateAlerts({ state }: { state: PortalActionState }) {
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

const METHODS = [
  "cash",
  "check",
  "money_order",
  "card",
  "ach",
  "online",
  "cash_app",
  "other",
] as const;

export function PaymentPreferenceForm({ current }: { current: string | null }) {
  const [state, formAction, pending] = useActionState<PortalActionState, FormData>(
    savePaymentPreferenceAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <StateAlerts state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="method">I usually pay by</Label>
          <select
            id="method"
            name="method"
            defaultValue={current ?? ""}
            className="h-9 w-44 rounded-md border px-3 text-sm capitalize"
          >
            <option value="">Not set</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

export function SmsConsentForm({ current }: { current: boolean }) {
  const [state, formAction, pending] = useActionState<PortalActionState, FormData>(
    setSmsConsentAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <StateAlerts state={state} />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="smsConsent"
          defaultChecked={current}
          className="mt-0.5 size-4 accent-primary"
        />
        <span>
          Text me account messages (rent reminders &amp; receipts). You can opt
          out anytime here or by replying <span className="font-mono">STOP</span>{" "}
          to any message.
        </span>
      </label>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save preference"}
      </Button>
    </form>
  );
}

export function CashPickupForm({ leaseId }: { leaseId: string | null }) {
  const [state, formAction, pending] = useActionState<PortalActionState, FormData>(
    requestCashPickupAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <StateAlerts state={state} />
      {leaseId && <input type="hidden" name="leaseId" value={leaseId} />}
      <div className="space-y-1">
        <Label htmlFor="pickup-note">Note for staff (optional)</Label>
        <Textarea
          id="pickup-note"
          name="note"
          rows={2}
          maxLength={2000}
          placeholder="e.g. Home after 5pm weekdays"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Sending…" : "I'll pay cash — request a pickup"}
      </Button>
    </form>
  );
}

export function MaintenanceRequestForm({ leaseId }: { leaseId: string | null }) {
  const [state, formAction, pending] = useActionState<PortalActionState, FormData>(
    submitMaintenanceRequestAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-3">
      <StateAlerts state={state} />
      {leaseId && <input type="hidden" name="leaseId" value={leaseId} />}
      <div className="space-y-1">
        <Label htmlFor="maintenance-message">What needs attention?</Label>
        <Textarea
          id="maintenance-message"
          name="message"
          rows={3}
          maxLength={2000}
          placeholder="Describe the issue and where it is"
          required
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Submitting…" : "Submit request"}
      </Button>
    </form>
  );
}
