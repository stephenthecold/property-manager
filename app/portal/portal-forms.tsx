"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  requestCashPickupAction,
  savePaymentPreferenceAction,
  saveReminderPrefAction,
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

/**
 * One per-reminder-type channel override row. The select offers SMS / Email /
 * Off; SMS and Email are disabled when the tenant hasn't consented to that
 * channel (the action enforces the same gate server-side). Saves on submit.
 */
export function ReminderPrefForm({
  reminderType,
  label,
  description,
  current,
  smsAvailable,
  emailAvailable,
}: {
  reminderType: string;
  label: string;
  description: string;
  /** Effective stored channel: "sms" | "email" | "off" (defaults follow global). */
  current: "sms" | "email" | "off";
  smsAvailable: boolean;
  emailAvailable: boolean;
}) {
  const [state, formAction, pending] = useActionState<PortalActionState, FormData>(
    saveReminderPrefAction,
    {},
  );
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end justify-between gap-3 border-t py-3 first:border-t-0"
    >
      <input type="hidden" name="reminderType" value={reminderType} />
      <div className="min-w-0 space-y-0.5">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
        {state.error && (
          <div className="text-xs text-red-600 dark:text-red-400">{state.error}</div>
        )}
        {state.ok && (
          <div className="text-xs text-emerald-600 dark:text-emerald-400">
            {state.message}
          </div>
        )}
      </div>
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`channel-${reminderType}`} className="sr-only">
            {label} channel
          </Label>
          <select
            id={`channel-${reminderType}`}
            name="channel"
            defaultValue={current}
            className="h-9 w-28 rounded-md border px-3 text-sm"
          >
            <option value="sms" disabled={!smsAvailable}>
              SMS{smsAvailable ? "" : " (off)"}
            </option>
            <option value="email" disabled={!emailAvailable}>
              Email{emailAvailable ? "" : " (off)"}
            </option>
            <option value="off">Off</option>
          </select>
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
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
      <div className="space-y-1">
        <Label htmlFor="maintenance-photos">Photos (optional)</Label>
        <input
          id="maintenance-photos"
          name="photos"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70"
        />
        <p className="text-xs text-muted-foreground">
          Up to 5 images (JPG/PNG/WebP, 10 MB each). A picture helps staff fix it faster.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Submitting…" : "Submit request"}
      </Button>
    </form>
  );
}
