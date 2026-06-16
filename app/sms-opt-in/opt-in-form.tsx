"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SmsConsentText } from "@/components/app/sms-consent-text";
import { submitSmsOptInAction, type OptInState } from "./actions";

export function SmsOptInForm({ businessName }: { businessName: string }) {
  const [state, action, pending] = useActionState<OptInState, FormData>(
    submitSmsOptInAction,
    {},
  );

  if (state.ok) {
    return (
      <Alert>
        <AlertDescription>
          Thanks! You&apos;re opted in to {businessName} SMS notifications. Reply{" "}
          <span className="font-mono">STOP</span> to any message to opt out, or{" "}
          <span className="font-mono">HELP</span> for help.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="fullName">Full name *</Label>
        <Input id="fullName" name="fullName" required autoComplete="name" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Mobile phone number *</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          required
          autoComplete="tel"
          placeholder="+15551234567"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email address *</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="propertyUnit">Property / unit (optional)</Label>
        <Input id="propertyUnit" name="propertyUnit" placeholder="123 Main St, Apt 2" />
      </div>

      {/* Separate, NOT pre-checked SMS consent — distinct from any other agreement. */}
      <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
        <input
          type="checkbox"
          name="smsConsent"
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span>
          <SmsConsentText />
        </span>
      </label>

      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Opt in to SMS notifications"}
      </Button>
    </form>
  );
}
