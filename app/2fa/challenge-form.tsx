"use client";

import { useActionState } from "react";
import { submitTwoFactorChallenge, type TwoFactorState } from "./actions";
import { doSignOut } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function TwoFactorChallengeForm() {
  const [state, formAction, pending] = useActionState<TwoFactorState, FormData>(
    submitTwoFactorChallenge,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="code">Authentication code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456 or a backup code"
          autoFocus
          required
        />
      </div>
      {state.error && (
        <Alert variant="destructive">
          <AlertTitle>Verification failed</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Verifying…" : "Verify"}
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
  );
}
