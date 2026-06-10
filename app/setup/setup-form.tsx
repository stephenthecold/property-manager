"use client";

import { useActionState } from "react";
import { createOwnerAction, type SetupState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function SetupForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<SetupState, FormData>(
    createOwnerAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {/* Exactly one field may carry name="token": with duplicates, FormData.get
          returns the first (the empty hidden one), rejecting every submission. */}
      {token ? (
        <input type="hidden" name="token" defaultValue={token} />
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="name">Owner name</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Owner email</Label>
        <Input id="email" name="email" type="email" required />
        <p className="text-xs text-muted-foreground">
          Use the same email your Authentik account will have — the SSO login links
          to this owner by email.
        </p>
      </div>
      {!token && (
        <div className="space-y-2">
          <Label htmlFor="token">Bootstrap token</Label>
          <Input id="token" name="token" required />
        </div>
      )}
      {state.error && (
        <Alert variant="destructive">
          <AlertTitle>Setup error</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Creating…" : "Create owner"}
      </Button>
    </form>
  );
}
