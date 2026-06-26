"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveMyNotificationsAction,
  type NotificationsState,
} from "./actions";

export interface NotificationsInitial {
  phone: string;
  notifyOverdueDigest: boolean;
  notifyMaintenanceDigest: boolean;
  notifyCashPickup: boolean;
}

const TOGGLES = [
  {
    name: "notifyOverdueDigest" as const,
    label: "Weekly overdue-rent digest (email)",
    description: "Monday summary of every overdue lease: who owes, how much, and aging.",
  },
  {
    name: "notifyMaintenanceDigest" as const,
    label: "Weekly maintenance digest (email)",
    description:
      "Monday summary of jobs and recurring tasks scheduled for the coming week (requires the Maintenance module).",
  },
  {
    name: "notifyCashPickup" as const,
    label: "Cash-pickup requests (email + text)",
    description:
      "Immediate alert when a tenant asks to pay rent in cash; texted too when a phone number is set below.",
  },
];

export function NotificationsForm({ initial }: { initial: NotificationsInitial }) {
  const [state, formAction, pending] = useActionState<NotificationsState, FormData>(
    saveMyNotificationsAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
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
      {TOGGLES.map((t) => (
        <label
          key={t.name}
          className="flex items-start gap-3 rounded-lg border p-3 hover:bg-muted/30"
        >
          <input
            type="checkbox"
            name={t.name}
            defaultChecked={initial[t.name]}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="block font-medium">{t.label}</span>
            <span className="block text-sm text-muted-foreground">{t.description}</span>
          </span>
        </label>
      ))}
      <div className="space-y-2">
        <Label htmlFor="phone">Mobile number for text alerts</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          placeholder="+1 555 000 1234"
          defaultValue={initial.phone}
        />
        <p className="text-xs text-muted-foreground">
          Leave blank for email-only alerts. Texts use the org SMS provider.
        </p>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save notifications"}
      </Button>
    </form>
  );
}
