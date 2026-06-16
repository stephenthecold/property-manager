"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveEmailAction,
  sendTestEmailAction,
  type MessagingState,
} from "./actions";

export interface EmailInitial {
  emailEnabled: boolean;
  /** "" = not configured, otherwise "stub" | "smtp". */
  emailProvider: string;
  emailFromAddress: string;
  emailFromName: string;
  emailSmtpHost: string;
  emailSmtpPort: string; // "" = derived from the TLS mode
  emailSmtpSecure: boolean;
  emailSmtpUser: string;
  /** "password" | "oauth2" */
  emailAuthMethod: string;
  emailOauthClientId: string;
  emailOauthTokenUrl: string;
  hasPassword: boolean;
  hasOauthClientSecret: boolean;
  hasOauthRefreshToken: boolean;
  /** Per-type email subject overrides ({ label, type, value }), blank = default. */
  subjects: Array<{ type: string; label: string; value: string }>;
}

const SECRET_HINT = "Stored encrypted (AES-256-GCM) and never shown again.";

export function EmailForm({ initial }: { initial: EmailInitial }) {
  const [state, formAction, pending] = useActionState<MessagingState, FormData>(
    saveEmailAction,
    {},
  );
  const [testState, testAction, testPending] = useActionState<
    MessagingState,
    FormData
  >(sendTestEmailAction, {});
  const [provider, setProvider] = useState(initial.emailProvider);
  const [authMethod, setAuthMethod] = useState(
    initial.emailAuthMethod || "password",
  );

  return (
    <div className="space-y-8">
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
            name="emailEnabled"
            defaultChecked={initial.emailEnabled}
          />
          Enable email sending (master switch)
        </label>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="emailProvider">Provider</Label>
            <select
              id="emailProvider"
              name="emailProvider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="">Not configured</option>
              <option value="stub">Stub (log only, no real email)</option>
              <option value="smtp">SMTP</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="emailFromAddress">From address</Label>
            <Input
              id="emailFromAddress"
              name="emailFromAddress"
              type="email"
              defaultValue={initial.emailFromAddress}
              placeholder="rent@yourdomain.com"
              disabled={provider !== "smtp"}
            />
          </div>
        </div>

        {provider === "smtp" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="emailFromName">From name (optional)</Label>
              <Input
                id="emailFromName"
                name="emailFromName"
                defaultValue={initial.emailFromName}
                placeholder="Shown to recipients, e.g. your business name"
                className="md:max-w-sm"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="emailSmtpHost">SMTP host</Label>
                <Input
                  id="emailSmtpHost"
                  name="emailSmtpHost"
                  defaultValue={initial.emailSmtpHost}
                  placeholder="smtp.gmail.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emailSmtpPort">Port</Label>
                <Input
                  id="emailSmtpPort"
                  name="emailSmtpPort"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={initial.emailSmtpPort}
                  placeholder="465 / 587"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="emailSmtpSecure"
                defaultChecked={initial.emailSmtpSecure}
              />
              Implicit TLS (port 465) — uncheck for STARTTLS (port 587)
            </label>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="emailSmtpUser">SMTP user</Label>
                <Input
                  id="emailSmtpUser"
                  name="emailSmtpUser"
                  defaultValue={initial.emailSmtpUser}
                  placeholder="rent@yourdomain.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="emailAuthMethod">Authentication</Label>
                <select
                  id="emailAuthMethod"
                  name="emailAuthMethod"
                  value={authMethod}
                  onChange={(e) => setAuthMethod(e.target.value)}
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="password">Password / app password</option>
                  <option value="oauth2">OAuth2 (Gmail, Microsoft 365)</option>
                </select>
              </div>
            </div>

            {authMethod === "password" ? (
              <div className="space-y-2">
                <Label htmlFor="emailPassword">Password</Label>
                <Input
                  id="emailPassword"
                  name="emailPassword"
                  type="password"
                  placeholder={
                    initial.hasPassword
                      ? "Configured — leave blank to keep"
                      : "Required"
                  }
                  autoComplete="off"
                  className="md:max-w-sm"
                />
                <p className="text-xs text-muted-foreground">{SECRET_HINT}</p>
              </div>
            ) : (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  XOAUTH2 with a refresh token. Leave the token URL blank for
                  Gmail; for Microsoft 365 use
                  https://login.microsoftonline.com/&lt;tenant&gt;/oauth2/v2.0/token.
                  {" " + SECRET_HINT}
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="emailOauthClientId">Client ID</Label>
                    <Input
                      id="emailOauthClientId"
                      name="emailOauthClientId"
                      defaultValue={initial.emailOauthClientId}
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="emailOauthClientSecret">Client secret</Label>
                    <Input
                      id="emailOauthClientSecret"
                      name="emailOauthClientSecret"
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
                    <Label htmlFor="emailOauthRefreshToken">Refresh token</Label>
                    <Input
                      id="emailOauthRefreshToken"
                      name="emailOauthRefreshToken"
                      type="password"
                      placeholder={
                        initial.hasOauthRefreshToken
                          ? "Configured — leave blank to keep"
                          : "Required"
                      }
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="emailOauthTokenUrl">
                      Token URL (blank = Gmail)
                    </Label>
                    <Input
                      id="emailOauthTokenUrl"
                      name="emailOauthTokenUrl"
                      defaultValue={initial.emailOauthTokenUrl}
                      placeholder="https://login.microsoftonline.com/…"
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        <div className="space-y-2 border-t pt-4">
          <p className="text-sm font-medium">Email subject lines</p>
          <p className="text-xs text-muted-foreground">
            Override the subject for each reminder type sent by email. Leave blank
            to use the built-in default. The body reuses the message templates.
            Supports the same {"{{variables}}"} (e.g. {"{{property}}"},{" "}
            {"{{due_date}}"}).
          </p>
          {initial.subjects.map((s) => (
            <div key={s.type} className="space-y-1">
              <Label htmlFor={`emailSubject_${s.type}`} className="text-xs">
                {s.label}
              </Label>
              <Input
                id={`emailSubject_${s.type}`}
                name={`emailSubject_${s.type}`}
                defaultValue={s.value}
                placeholder="(default subject)"
              />
            </div>
          ))}
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save email settings"}
        </Button>
      </form>

      <form action={testAction} className="space-y-3 rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Send a test email</p>
          <p className="text-xs text-muted-foreground">
            Uses the saved configuration above. The stub provider only logs.
          </p>
        </div>
        {testState.error && (
          <Alert variant="destructive">
            <AlertDescription>{testState.error}</AlertDescription>
          </Alert>
        )}
        {testState.ok && (
          <Alert>
            <AlertDescription>{testState.message}</AlertDescription>
          </Alert>
        )}
        <div className="flex items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="testEmail">Email address</Label>
            <Input
              id="testEmail"
              name="testEmail"
              type="email"
              placeholder="you@example.com"
              className="w-64"
            />
          </div>
          <Button type="submit" variant="outline" disabled={testPending}>
            {testPending ? "Sending…" : "Send test"}
          </Button>
        </div>
      </form>
    </div>
  );
}
