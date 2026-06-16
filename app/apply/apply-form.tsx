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
import {
  questionInputName,
  type CustomSection,
} from "@/lib/applications/custom-questions";
import { SmsConsentText } from "@/components/app/sms-consent-text";
import { submitApplicationAction, type ApplyState } from "./actions";

export function ApplyForm({
  unitId,
  businessName,
  config,
  customSections,
}: {
  unitId: string | null;
  businessName: string;
  config: ApplicationFormConfig;
  customSections: CustomSection[];
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

      {customSections.map((section) => (
        <div key={section.id} className="space-y-3 border-t pt-4">
          {section.title && (
            <h2 className="text-sm font-semibold">{section.title}</h2>
          )}
          {section.description && (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">
              {section.description}
            </p>
          )}
          {section.questions.map((q) => {
            const name = questionInputName(q.id);
            const reqStar = q.required ? (
              <span className="text-red-500"> *</span>
            ) : null;
            if (q.type === "yes_no") {
              return (
                <label key={q.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name={name}
                    value="yes"
                    className="size-4"
                  />
                  {q.label}
                  {reqStar}
                </label>
              );
            }
            if (q.type === "multi_select") {
              return (
                <fieldset key={q.id} className="space-y-2">
                  <legend className="text-sm font-medium">
                    {q.label}
                    {reqStar}
                  </legend>
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {q.options.map((opt) => (
                      <label
                        key={opt}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          name={name}
                          value={opt}
                          className="size-4"
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            if (q.type === "single_select") {
              return (
                <div key={q.id} className="space-y-2">
                  <Label htmlFor={name}>
                    {q.label}
                    {reqStar}
                  </Label>
                  <select
                    id={name}
                    name={name}
                    required={q.required}
                    defaultValue=""
                    className="w-full rounded-md border p-2 text-sm"
                  >
                    <option value="">Select…</option>
                    {q.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }
            if (q.type === "long_text") {
              return (
                <div key={q.id} className="space-y-2">
                  <Label htmlFor={name}>
                    {q.label}
                    {reqStar}
                  </Label>
                  <textarea
                    id={name}
                    name={name}
                    rows={3}
                    maxLength={2000}
                    required={q.required}
                    className="w-full rounded-md border p-2 text-sm"
                  />
                </div>
              );
            }
            return (
              <div key={q.id} className="space-y-2">
                <Label htmlFor={name}>
                  {q.label}
                  {reqStar}
                </Label>
                <Input id={name} name={name} required={q.required} maxLength={200} />
              </div>
            );
          })}
        </div>
      ))}

      {/* Optional SMS consent — separate, not pre-checked, never required to apply. */}
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
        {pending ? "Submitting…" : "Submit application"}
      </Button>
    </form>
  );
}
