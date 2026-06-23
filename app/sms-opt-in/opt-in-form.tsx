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
          {state.consented ? (
            <>
              Thanks! You&apos;re opted in to {businessName} SMS notifications.
              Reply <span className="font-mono">STOP</span> to any message to opt
              out, or <span className="font-mono">HELP</span> for help.
            </>
          ) : (
            <>
              Thanks — your details were submitted. The SMS consent box was left
              unchecked, so we did <strong>not</strong> opt you in to text
              messages. You can opt in anytime by submitting again with the box
              checked.
            </>
          )}
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

      {/* Separate, NOT pre-checked, NOT required SMS consent — distinct from any
          other agreement. Optional by design: the form submits with or without
          it, so a mandatory phone field is never paired with a mandatory opt-in
          checkbox (10DLC "forced opt-in"). */}
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
      <p className="text-xs text-muted-foreground">
        This checkbox is optional — you can submit the form without it. SMS
        consent is never required as a condition of renting.
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit"}
      </Button>
    </form>
  );
}
