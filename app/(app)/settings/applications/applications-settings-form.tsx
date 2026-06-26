"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  APPLICATION_FIELDS,
  type ApplicationFormConfig,
} from "@/lib/applications/form-config";
import {
  saveApplicationFieldsAction,
  type ApplicationSettingsState,
} from "./actions";

/**
 * Per-field config for the public /apply form: hidden / optional / required.
 * Name is always required (not listed); contact methods (email/phone) can't be
 * hidden — only optional or required.
 */
export function ApplicationsSettingsForm({
  config,
}: {
  config: ApplicationFormConfig;
}) {
  const [state, action, pending] = useActionState<ApplicationSettingsState, FormData>(
    saveApplicationFieldsAction,
    {},
  );

  return (
    <form action={action} className="space-y-4">
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

      <p className="text-sm text-muted-foreground">
        Choose what appears on the public application form and which fields
        applicants must fill in. First and last name are always required, and at
        least one of email or phone is always collected.
      </p>

      <div className="divide-y rounded-md border">
        {APPLICATION_FIELDS.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <Label htmlFor={`field_${f.key}`} className="text-sm font-medium">
              {f.label}
            </Label>
            <select
              id={`field_${f.key}`}
              name={`field_${f.key}`}
              defaultValue={config[f.key]}
              className="h-9 w-full rounded-md border px-3 text-sm capitalize"
            >
              {!f.contact && <option value="hidden">Hidden</option>}
              <option value="optional">Optional</option>
              <option value="required">Required</option>
            </select>
          </div>
        ))}
      </div>

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save form"}
      </Button>
    </form>
  );
}
