"use client";

import { useActionState } from "react";
import {
  confirmForcedEnrollment,
  finishForcedEnrollment,
  type EnrollState,
} from "../actions";
import { doSignOut } from "@/app/login/actions";
import { BackupCodesPanel } from "@/components/app/backup-codes-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ForcedEnrollForm({
  secret,
  otpauthUrl,
}: {
  secret: string;
  otpauthUrl: string;
}) {
  const [state, formAction, pending] = useActionState<EnrollState, FormData>(
    confirmForcedEnrollment,
    {},
  );

  // Step 2: code confirmed — show one-time backup codes, then continue.
  if (state.backupCodes) {
    return (
      <div className="space-y-4">
        <Alert>
          <AlertTitle>Two-factor authentication is on</AlertTitle>
          <AlertDescription>
            Save these one-time backup codes somewhere safe. Each works once if
            you lose access to your authenticator app.
          </AlertDescription>
        </Alert>
        <BackupCodesPanel codes={state.backupCodes} />
        <form action={finishForcedEnrollment}>
          <Button type="submit" className="w-full">
            I&apos;ve saved my codes — continue
          </Button>
        </form>
      </div>
    );
  }

  // Step 1: show the secret / otpauth link and confirm a code.
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">1. Add this account to your app</p>
        <p className="text-sm text-muted-foreground">
          Scan the link below in your authenticator app, or enter the secret key
          manually.
        </p>
        <a
          href={otpauthUrl}
          className="block truncate rounded-md border bg-muted px-3 py-2 text-xs underline underline-offset-2"
        >
          {otpauthUrl}
        </a>
        <div>
          <Label className="text-xs text-muted-foreground">Secret key</Label>
          <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all">
            {secret}
          </code>
        </div>
      </div>

      <form action={formAction} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="code">2. Enter the 6-digit code</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
        </div>
        {state.error && (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t verify</AlertTitle>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Verifying…" : "Confirm and enable"}
        </Button>
        <div className="text-center text-sm text-muted-foreground">
          <button
            type="submit"
            formAction={doSignOut}
            className="underline underline-offset-2"
          >
            Cancel and sign out
          </button>
        </div>
      </form>
    </div>
  );
}
