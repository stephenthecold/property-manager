"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  disconnectInboxAction,
  saveInboxOauthClientAction,
  type InboxSettingsState,
} from "./actions";

type Provider = "microsoft" | "google";

export interface InboxConnectInitial {
  /** Currently-saved connect provider ("" if none). */
  provider: string;
  tenant: string;
  clientId: string;
  hasClientSecret: boolean;
  /** A refresh token is stored (i.e. a mailbox is connected). */
  connected: boolean;
  connectedProvider: string | null;
  connectedMailbox: string;
  redirectUri: { microsoft: string; google: string };
}

const LABELS: Record<Provider, string> = {
  microsoft: "Microsoft 365",
  google: "Google / Gmail",
};

const SECRET_HINT = "Stored encrypted (AES-256-GCM) and never shown again.";

export function InboxConnect({ initial }: { initial: InboxConnectInitial }) {
  const [state, formAction, pending] = useActionState<InboxSettingsState, FormData>(
    saveInboxOauthClientAction,
    {},
  );
  const [provider, setProvider] = useState<Provider>(
    initial.provider === "google" ? "google" : "microsoft",
  );

  // Connect is only usable once THIS provider's client secret has been saved.
  const savedForProvider =
    initial.provider === provider && initial.hasClientSecret && !!initial.clientId;

  return (
    <div className="space-y-4">
      {initial.connected && initial.connectedProvider && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
          <span className="text-sm">
            <Badge
              variant="outline"
              className="mr-2 border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
            >
              Connected
            </Badge>
            {LABELS[initial.connectedProvider === "google" ? "google" : "microsoft"]}
            {initial.connectedMailbox ? ` · ${initial.connectedMailbox}` : ""}
          </span>
          <form action={disconnectInboxAction}>
            <Button type="submit" variant="outline" size="sm">
              Disconnect
            </Button>
          </form>
        </div>
      )}

      <div className="flex gap-1">
        {(["microsoft", "google"] as Provider[]).map((p) => (
          <Button
            key={p}
            type="button"
            variant={p === provider ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setProvider(p)}
          >
            {LABELS[p]}
          </Button>
        ))}
      </div>

      <form action={formAction} className="space-y-3 rounded-md border p-3">
        <input type="hidden" name="oauthProvider" value={provider} />
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

        <p className="text-xs text-muted-foreground">
          Register an app with your provider, add the redirect URI below, then
          paste its Client ID and secret here. You sign in once via{" "}
          <strong>Connect</strong> — no token pasting, admin-consent, or access
          policies. See <span className="font-mono">docs/EMAIL_INBOX.md</span>.
        </p>

        <div className="space-y-1">
          <Label className="text-xs">Redirect URI (add this to your app)</Label>
          <code className="block overflow-x-auto rounded border bg-muted/50 px-2 py-1 text-xs">
            {initial.redirectUri[provider]}
          </code>
        </div>

        {provider === "microsoft" && (
          <div className="space-y-2">
            <Label htmlFor="oauthTenant">Directory (tenant) ID</Label>
            <Input
              id="oauthTenant"
              name="oauthTenant"
              defaultValue={initial.provider === "microsoft" ? initial.tenant : ""}
              placeholder="common, or your tenant GUID"
              autoComplete="off"
            />
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="oauthClientId">Client ID</Label>
            <Input
              id="oauthClientId"
              name="oauthClientId"
              defaultValue={initial.provider === provider ? initial.clientId : ""}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="oauthClientSecret">Client secret</Label>
            <Input
              id="oauthClientSecret"
              name="oauthClientSecret"
              type="password"
              placeholder={
                initial.provider === provider && initial.hasClientSecret
                  ? "Configured — leave blank to keep"
                  : "Required"
              }
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{SECRET_HINT}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "Saving…" : "Save connection settings"}
          </Button>
          {savedForProvider ? (
            <Button render={<a href={`/api/inbox/oauth/${provider}/start`} />}>
              {initial.connected ? `Reconnect ${LABELS[provider]}` : `Connect ${LABELS[provider]}`}
            </Button>
          ) : (
            <Button type="button" disabled title="Save the settings above first">
              Connect {LABELS[provider]}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
