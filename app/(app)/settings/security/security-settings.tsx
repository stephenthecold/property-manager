"use client";

import { useActionState } from "react";
import {
  startEnrollment,
  confirmEnrollment,
  disableTwoFactor,
  regenerateCodes,
  type SecurityState,
} from "./actions";
import { BackupCodesPanel } from "@/components/app/backup-codes-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function SecuritySettings({
  enrolled,
  backupCodesRemaining,
}: {
  enrolled: boolean;
  backupCodesRemaining: number;
}) {
  if (enrolled) {
    return <EnrolledPanel backupCodesRemaining={backupCodesRemaining} />;
  }
  return <EnrollPanel />;
}

/** Not enrolled: start -> scan -> confirm -> show backup codes. */
function EnrollPanel() {
  const [start, startAction, starting] = useActionState<SecurityState, FormData>(
    startEnrollment,
    {},
  );
  const [confirm, confirmAction, confirming] = useActionState<SecurityState, FormData>(
    confirmEnrollment,
    {},
  );

  // After a successful confirm, show the one-time backup codes.
  if (confirm.backupCodes) {
    return (
      <div className="space-y-3">
        <Alert>
          <AlertTitle>{confirm.message ?? "Two-factor authentication enabled"}</AlertTitle>
          <AlertDescription>
            Save these one-time backup codes. Each works once if you lose your
            authenticator. They will not be shown again.
          </AlertDescription>
        </Alert>
        <BackupCodesPanel codes={confirm.backupCodes} />
      </div>
    );
  }

  // The active enrollment secret comes from whichever action produced it.
  const enrolling = confirm.enrolling ?? start.enrolling;

  if (!enrolling) {
    return (
      <form action={startAction} className="space-y-3">
        {start.error && (
          <Alert variant="destructive">
            <AlertDescription>{start.error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={starting}>
          {starting ? "Preparing…" : "Set up two-factor authentication"}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">1. Add this account to your app</p>
        <a
          href={enrolling.otpauthUrl}
          className="block truncate rounded-md border bg-muted px-3 py-2 text-xs underline underline-offset-2"
        >
          {enrolling.otpauthUrl}
        </a>
        <div>
          <Label className="text-xs text-muted-foreground">Secret key</Label>
          <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all">
            {enrolling.secret}
          </code>
        </div>
      </div>

      <form action={confirmAction} className="space-y-3">
        <input type="hidden" name="secret" value={enrolling.secret} />
        <div className="space-y-2">
          <Label htmlFor="code">2. Enter the 6-digit code to confirm</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            required
          />
        </div>
        {confirm.error && (
          <Alert variant="destructive">
            <AlertDescription>{confirm.error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={confirming}>
          {confirming ? "Verifying…" : "Confirm and enable"}
        </Button>
      </form>
    </div>
  );
}

/** Enrolled: show status, regenerate backup codes, and disable. */
function EnrolledPanel({ backupCodesRemaining }: { backupCodesRemaining: number }) {
  const [regen, regenAction, regenerating] = useActionState<SecurityState, FormData>(
    regenerateCodes,
    {},
  );
  const [disable, disableAction, disabling] = useActionState<SecurityState, FormData>(
    disableTwoFactor,
    {},
  );

  return (
    <div className="space-y-5">
      <Alert>
        <AlertTitle>Two-factor authentication is on</AlertTitle>
        <AlertDescription>
          {backupCodesRemaining} backup code{backupCodesRemaining === 1 ? "" : "s"} remaining.
        </AlertDescription>
      </Alert>

      {regen.backupCodes && (
        <div className="space-y-2">
          <p className="text-sm font-medium">New backup codes</p>
          <BackupCodesPanel codes={regen.backupCodes} />
          <p className="text-xs text-muted-foreground">
            Your previous backup codes no longer work.
          </p>
        </div>
      )}

      <form action={regenAction} className="space-y-2">
        {regen.error && (
          <Alert variant="destructive">
            <AlertDescription>{regen.error}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" variant="outline" disabled={regenerating}>
          {regenerating ? "Generating…" : "Regenerate backup codes"}
        </Button>
      </form>

      <div className="border-t pt-4">
        <p className="mb-2 text-sm font-medium">Disable two-factor authentication</p>
        <form action={disableAction} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="disable-code">Enter a current code or backup code to confirm</Label>
            <Input
              id="disable-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456 or a backup code"
              required
            />
          </div>
          {disable.error && (
            <Alert variant="destructive">
              <AlertDescription>{disable.error}</AlertDescription>
            </Alert>
          )}
          {disable.message && (
            <Alert>
              <AlertDescription>{disable.message}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" variant="destructive" disabled={disabling}>
            {disabling ? "Disabling…" : "Disable two-factor"}
          </Button>
        </form>
      </div>
    </div>
  );
}
