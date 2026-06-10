"use client";

import { useActionState } from "react";
import { signInBreakGlass, type EmergencyState } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function EmergencyPage() {
  const [state, formAction, pending] = useActionState<EmergencyState, FormData>(
    signInBreakGlass,
    {},
  );

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Emergency access</CardTitle>
          <CardDescription>
            Break-glass owner login for when single sign-on is unavailable. Every
            attempt is audited. This session is short-lived; once SSO is in use
            it cannot change authentication settings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="passphrase">Emergency passphrase</Label>
              <Input
                id="passphrase"
                name="passphrase"
                type="password"
                autoComplete="off"
                required
              />
            </div>
            {state.error && (
              <Alert variant="destructive">
                <AlertTitle>Access denied</AlertTitle>
                <AlertDescription>{state.error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Verifying…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
