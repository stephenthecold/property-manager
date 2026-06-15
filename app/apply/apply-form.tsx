"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isRequired,
  isShown,
  type ApplicationFormConfig,
} from "@/lib/applications/form-config";
import { submitApplicationAction, type ApplyState } from "./actions";

export function ApplyForm({
  unitId,
  businessName,
  config,
}: {
  unitId: string | null;
  businessName: string;
  config: ApplicationFormConfig;
}) {
  const [state, action, pending] = useActionState<ApplyState, FormData>(
    submitApplicationAction,
    {},
  );

  const show = (k: string) => isShown(config, k);
  const req = (k: string) => isRequired(config, k);
  const star = (k: string) =>
    req(k) ? <span className="text-red-500"> *</span> : null;

  if (state.ok) {
    return (
      <Alert>
        <AlertDescription>
          Thanks! Your application has been submitted to {businessName}. We will
          be in touch using the contact details you provided.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {unitId && <input type="hidden" name="unitId" value={unitId} />}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name *</Label>
          <Input id="firstName" name="firstName" required autoComplete="given-name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name *</Label>
          <Input id="lastName" name="lastName" required autoComplete="family-name" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email{star("email")}</Label>
          <Input id="email" name="email" type="email" required={req("email")} autoComplete="email" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="phone">Phone{star("phone")}</Label>
          <Input id="phone" name="phone" type="tel" required={req("phone")} autoComplete="tel" placeholder="+15551234567" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Provide at least an email or a phone number so we can reach you.
      </p>

      {show("currentAddress") && (
        <div className="space-y-2">
          <Label htmlFor="currentAddress">Current address{star("currentAddress")}</Label>
          <Input id="currentAddress" name="currentAddress" required={req("currentAddress")} autoComplete="street-address" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {show("desiredMoveInDate") && (
          <div className="space-y-2">
            <Label htmlFor="desiredMoveInDate">Desired move-in date{star("desiredMoveInDate")}</Label>
            <Input id="desiredMoveInDate" name="desiredMoveInDate" type="date" required={req("desiredMoveInDate")} />
          </div>
        )}
        {show("monthlyIncome") && (
          <div className="space-y-2">
            <Label htmlFor="monthlyIncome">Monthly income{star("monthlyIncome")}</Label>
            <Input id="monthlyIncome" name="monthlyIncome" inputMode="decimal" required={req("monthlyIncome")} placeholder="0.00" />
          </div>
        )}
        {show("employer") && (
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="employer">Employer{star("employer")}</Label>
            <Input id="employer" name="employer" required={req("employer")} autoComplete="organization" />
          </div>
        )}
      </div>

      {show("message") && (
        <div className="space-y-2">
          <Label htmlFor="message">Anything else we should know?{star("message")}</Label>
          <textarea
            id="message"
            name="message"
            rows={4}
            maxLength={2000}
            required={req("message")}
            className="w-full rounded-md border p-2 text-sm"
          />
        </div>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
