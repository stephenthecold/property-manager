"use client";

import * as React from "react";
import { useActionState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  portalCodeLoginAction,
  portalPasswordLoginAction,
  portalRequestCodeAction,
  type PortalLoginState,
} from "./actions";

function StateAlerts({ state }: { state: PortalLoginState }) {
  return (
    <>
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.message && !state.error && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
    </>
  );
}

function PasswordTab() {
  const [state, formAction, pending] = useActionState<PortalLoginState, FormData>(
    portalPasswordLoginAction,
    {},
  );
  return (
    <form action={formAction} className="space-y-4">
      <StateAlerts state={state} />
      <div className="space-y-2">
        <Label htmlFor="identifier">Email or phone</Label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          placeholder="you@example.com or 555 123 4567"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-xs">
        <Link href="/portal/forgot" className="text-muted-foreground hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

function CodeTab() {
  // Two-step: request the code, then redeem it. One shared phone field.
  const [requestState, requestAction, requestPending] = useActionState<
    PortalLoginState,
    FormData
  >(portalRequestCodeAction, {});
  const [loginState, loginAction, loginPending] = useActionState<
    PortalLoginState,
    FormData
  >(portalCodeLoginAction, {});
  const [phone, setPhone] = React.useState("");
  const codeSent = requestState.codeSent || loginState.codeSent;

  return (
    <div className="space-y-4">
      <StateAlerts state={loginState.error || loginState.message ? loginState : requestState} />
      <form action={requestAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="otp-phone">Phone number</Label>
          <Input
            id="otp-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="555 123 4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        <Button
          type="submit"
          variant={codeSent ? "outline" : "default"}
          className="w-full"
          disabled={requestPending}
        >
          {requestPending ? "Sending…" : codeSent ? "Send a new code" : "Text me a code"}
        </Button>
      </form>
      {codeSent && (
        <form action={loginAction} className="space-y-4">
          <input type="hidden" name="phone" value={phone} />
          <div className="space-y-2">
            <Label htmlFor="otp-code">6-digit code</Label>
            <Input
              id="otp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={loginPending}>
            {loginPending ? "Verifying…" : "Sign in with code"}
          </Button>
        </form>
      )}
    </div>
  );
}

export function PortalLoginForm() {
  return (
    <Tabs defaultValue="password">
      <TabsList className="w-full">
        <TabsTrigger value="password">Password</TabsTrigger>
        <TabsTrigger value="code">Text me a code</TabsTrigger>
      </TabsList>
      <TabsContent value="password" className="pt-3">
        <PasswordTab />
      </TabsContent>
      <TabsContent value="code" className="pt-3">
        <CodeTab />
      </TabsContent>
    </Tabs>
  );
}
