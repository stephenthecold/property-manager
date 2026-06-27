"use client";

import { useActionState } from "react";
import {
  disableBreakGlassAction,
  saveOidcSettings,
  testConnectionAction,
  type SaveState,
} from "./actions";
import type { OidcTestResult } from "@/lib/auth/oidc-test";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Initial {
  enabled: boolean;
  issuer: string;
  clientId: string;
  scopes: string;
  hasSecret: boolean;
  groupMappings: string;
  allowOwnerFromGroup: boolean;
  source: "db" | "env" | "disabled";
}

export function AuthSettingsForm({
  initial,
  viaBreakGlass,
  authLocked,
  breakGlassEnabled,
  breakGlassExpiresAt,
}: {
  initial: Initial;
  viaBreakGlass: boolean;
  /** Break-glass session AND OIDC already in use — settings are read-only. */
  authLocked: boolean;
  breakGlassEnabled: boolean;
  breakGlassExpiresAt: string | null;
}) {
  const [saveState, saveAction, saving] = useActionState<SaveState, FormData>(
    saveOidcSettings,
    {},
  );
  const [testState, testAction, testing] = useActionState<
    OidcTestResult,
    FormData
  >(testConnectionAction, { ok: false });

  const disabled = authLocked;

  return (
    <div className="space-y-8">
      {authLocked && (
        <Alert variant="destructive">
          <AlertTitle>Break-glass session</AlertTitle>
          <AlertDescription>
            Authentication settings are read-only while signed in via emergency
            access. Sign in through your IdP to make changes.
          </AlertDescription>
        </Alert>
      )}
      {viaBreakGlass && !authLocked && (
        <Alert>
          <AlertTitle>Break-glass session — initial setup</AlertTitle>
          <AlertDescription>
            You can configure and enable OIDC now. Once the first SSO sign-in
            succeeds, these settings become read-only for break-glass sessions.
          </AlertDescription>
        </Alert>
      )}

      <form action={saveAction} className="space-y-4">
        <div className="flex items-center gap-2">
          <input
            id="enabled"
            name="enabled"
            type="checkbox"
            defaultChecked={initial.enabled}
            disabled={disabled}
            className="size-4"
          />
          <Label htmlFor="enabled">Enable Authentik / OIDC sign-in</Label>
        </div>

        <div className="space-y-2">
          <Label htmlFor="issuer">Issuer URL</Label>
          <Input
            id="issuer"
            name="issuer"
            defaultValue={initial.issuer}
            placeholder="https://authentik.example.com/application/o/property-manager/"
            disabled={disabled}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="clientId">Client ID</Label>
            <Input
              id="clientId"
              name="clientId"
              defaultValue={initial.clientId}
              disabled={disabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="scopes">Scopes</Label>
            <Input
              id="scopes"
              name="scopes"
              defaultValue={initial.scopes}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientSecret">Client secret</Label>
          <Input
            id="clientSecret"
            name="clientSecret"
            type="password"
            autoComplete="off"
            placeholder={
              initial.hasSecret ? "•••••••• (set — leave blank to keep)" : "Enter client secret"
            }
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted (AES-256-GCM). Never displayed back; leave blank to
            keep the current value.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="groupMappings">Group → role mappings (JSON)</Label>
          <Textarea
            id="groupMappings"
            name="groupMappings"
            defaultValue={initial.groupMappings}
            placeholder='{"managers":"manager","admins":"admin"}'
            disabled={disabled}
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="allowOwnerFromGroup"
            name="allowOwnerFromGroup"
            type="checkbox"
            defaultChecked={initial.allowOwnerFromGroup}
            disabled={disabled}
            className="size-4"
          />
          <Label htmlFor="allowOwnerFromGroup">
            Allow the <code>owner</code> role to be granted from a group (not
            recommended)
          </Label>
        </div>

        {saveState.error && (
          <Alert variant="destructive">
            <AlertDescription>{saveState.error}</AlertDescription>
          </Alert>
        )}
        {saveState.ok && (
          <Alert>
            <AlertDescription>Settings saved.</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={disabled || saving}>
          {saving ? "Saving…" : "Save settings"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Active source: <strong>{initial.source}</strong>
        </p>
      </form>

      <form action={testAction} className="space-y-3 border-t pt-6">
        <Label htmlFor="test-issuer">Test connection — issuer</Label>
        <Input
          id="test-issuer"
          name="issuer"
          defaultValue={initial.issuer}
          placeholder="https://authentik.example.com/application/o/property-manager/"
        />
        <Button type="submit" variant="outline" disabled={testing}>
          {testing ? "Testing…" : "Test connection"}
        </Button>
        {testState.error && (
          <Alert variant="destructive">
            <AlertDescription>{testState.error}</AlertDescription>
          </Alert>
        )}
        {testState.ok && (
          <Alert>
            <AlertTitle>Discovery OK</AlertTitle>
            <AlertDescription>
              issuer: {testState.issuer}
              <br />
              token endpoint: {testState.endpoints?.token}
            </AlertDescription>
          </Alert>
        )}
      </form>

      <div className="space-y-3 border-t pt-6">
        <h2 className="font-medium">Break-glass emergency access</h2>
        {breakGlassEnabled ? (
          <Alert variant="destructive">
            <AlertTitle>Break-glass is ENABLED</AlertTitle>
            <AlertDescription>
              A local emergency login is active
              {breakGlassExpiresAt
                ? ` until ${new Date(breakGlassExpiresAt).toLocaleString()}`
                : ""}
              . Disable it once SSO is verified.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">
            Break-glass is disabled. Re-enable it with{" "}
            <code>npm run breakglass issue</code> if you lose SSO access.
          </p>
        )}
        {breakGlassEnabled && !viaBreakGlass && (
          <form action={disableBreakGlassAction}>
            <Button type="submit" variant="outline">
              Disable break-glass now
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
