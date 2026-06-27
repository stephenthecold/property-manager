"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveInboxAction, type InboxSettingsState } from "./actions";

export interface InboxInitial {
  inboxEnabled: boolean;
  /** "" = not configured, otherwise "stub" | "imap". */
  inboxProvider: string;
  inboxImapHost: string;
  inboxImapPort: string;
  inboxImapSecure: boolean;
  inboxImapUser: string;
  inboxFolder: string;
  /** "password" | "oauth2" */
  inboxAuthMethod: string;
  inboxOauthClientId: string;
  inboxOauthTokenUrl: string;
  inboxOauthScope: string;
  hasPassword: boolean;
  hasOauthClientSecret: boolean;
  hasOauthRefreshToken: boolean;
}

const SECRET_HINT = "Stored encrypted (AES-256-GCM) and never shown again.";

export function InboxForm({ initial }: { initial: InboxInitial }) {
  const [state, formAction, pending] = useActionState<InboxSettingsState, FormData>(
    saveInboxAction,
    {},
  );
  const [provider, setProvider] = useState(initial.inboxProvider);
  const [authMethod, setAuthMethod] = useState(
    initial.inboxAuthMethod || "password",
  );

  return (
    <form action={formAction} className="space-y-4">
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

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="inboxEnabled"
          defaultChecked={initial.inboxEnabled}
        />
        Enable mailbox polling (master switch)
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="inboxProvider">Provider</Label>
          <select
            id="inboxProvider"
            name="inboxProvider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="h-9 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Not configured</option>
            <option value="stub">Stub (canned demo messages)</option>
            <option value="imap">IMAP mailbox</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inboxImapUser">Mailbox address</Label>
          <Input
            id="inboxImapUser"
            name="inboxImapUser"
            defaultValue={initial.inboxImapUser}
            placeholder="invoices@yourdomain.com"
            autoComplete="off"
            disabled={provider !== "imap"}
          />
        </div>
      </div>

      {provider === "imap" && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="inboxImapHost">IMAP host</Label>
              <Input
                id="inboxImapHost"
                name="inboxImapHost"
                defaultValue={initial.inboxImapHost}
                placeholder="outlook.office365.com / imap.gmail.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inboxImapPort">Port</Label>
              <Input
                id="inboxImapPort"
                name="inboxImapPort"
                type="number"
                min={1}
                max={65535}
                defaultValue={initial.inboxImapPort}
                placeholder="993"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="inboxImapSecure"
                defaultChecked={initial.inboxImapSecure}
              />
              Implicit TLS (port 993)
            </label>
            <div className="space-y-2">
              <Label htmlFor="inboxFolder">Folder (blank = INBOX)</Label>
              <Input
                id="inboxFolder"
                name="inboxFolder"
                defaultValue={initial.inboxFolder}
                placeholder="INBOX"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inboxAuthMethod">Authentication</Label>
            <select
              id="inboxAuthMethod"
              name="inboxAuthMethod"
              value={authMethod}
              onChange={(e) => setAuthMethod(e.target.value)}
              className="h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="password">Password / app password</option>
              <option value="oauth2">OAuth2 / XOAUTH2 (Microsoft 365)</option>
            </select>
          </div>

          {authMethod === "password" ? (
            <div className="space-y-2">
              <Label htmlFor="inboxPassword">Password</Label>
              <Input
                id="inboxPassword"
                name="inboxPassword"
                type="password"
                placeholder={
                  initial.hasPassword ? "Configured — leave blank to keep" : "Required"
                }
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Self-hosted IMAP or a Gmail app password. Microsoft 365 disables
                IMAP basic auth — use OAuth2 instead. {SECRET_HINT}
              </p>
            </div>
          ) : (
            <div className="space-y-3 rounded-md border p-3">
              <p className="text-xs text-muted-foreground">
                XOAUTH2. Leave the refresh token blank to use the
                client-credentials (app-only) grant — the recommended Microsoft
                365 service path (register an app with the
                <span className="font-mono"> IMAP.AccessAsApp </span>
                permission and scope it to the mailbox; see docs/EMAIL_INBOX.md).
                Provide a refresh token to use a delegated grant instead.{" "}
                {SECRET_HINT}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="inboxOauthClientId">Client ID</Label>
                  <Input
                    id="inboxOauthClientId"
                    name="inboxOauthClientId"
                    defaultValue={initial.inboxOauthClientId}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inboxOauthClientSecret">Client secret</Label>
                  <Input
                    id="inboxOauthClientSecret"
                    name="inboxOauthClientSecret"
                    type="password"
                    placeholder={
                      initial.hasOauthClientSecret
                        ? "Configured — leave blank to keep"
                        : "Required"
                    }
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inboxOauthTokenUrl">Token URL</Label>
                  <Input
                    id="inboxOauthTokenUrl"
                    name="inboxOauthTokenUrl"
                    defaultValue={initial.inboxOauthTokenUrl}
                    placeholder="https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inboxOauthScope">
                    Scope (blank = Outlook .default)
                  </Label>
                  <Input
                    id="inboxOauthScope"
                    name="inboxOauthScope"
                    defaultValue={initial.inboxOauthScope}
                    placeholder="https://outlook.office365.com/.default"
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="inboxOauthRefreshToken">
                    Refresh token (optional — delegated grant)
                  </Label>
                  <Input
                    id="inboxOauthRefreshToken"
                    name="inboxOauthRefreshToken"
                    type="password"
                    placeholder={
                      initial.hasOauthRefreshToken
                        ? "Configured — leave blank to keep"
                        : "Leave blank for app-only (client credentials)"
                    }
                    autoComplete="off"
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save inbox settings"}
      </Button>
    </form>
  );
}
