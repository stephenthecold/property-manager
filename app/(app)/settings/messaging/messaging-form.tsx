"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveMessagingAction,
  sendTestSmsAction,
  type MessagingState,
} from "./actions";

export interface MessagingInitial {
  smsEnabled: boolean;
  /** "" = use env config, otherwise "stub" | "twilio" | "telnyx". */
  smsProvider: string;
  smsAccountSid: string;
  hasAuthToken: boolean;
  smsFromNumber: string;
  reminderDueSoonDays: string; // "" = env default
  envDueSoonDays: number;
  envProvider: string;
  dueSoonRemindersEnabled: boolean;
  overdueRemindersEnabled: boolean;
  templates: Array<{
    type: string;
    label: string;
    value: string; // stored override ("" when using the default)
    defaultBody: string;
  }>;
}

const VARS_HINT =
  "Variables: {{tenant_name}} {{first_name}} {{property}} {{unit}} {{amount_due}} {{due_date}} {{balance}}";

export function MessagingForm({ initial }: { initial: MessagingInitial }) {
  const [state, formAction, pending] = useActionState<MessagingState, FormData>(
    saveMessagingAction,
    {},
  );
  const [testState, testAction, testPending] = useActionState<
    MessagingState,
    FormData
  >(sendTestSmsAction, {});
  const [provider, setProvider] = useState(initial.smsProvider);

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
            name="smsEnabled"
            defaultChecked={initial.smsEnabled}
          />
          Enable SMS sending (master switch for manual, bulk, and scheduled)
        </label>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="smsProvider">Provider</Label>
            <select
              id="smsProvider"
              name="smsProvider"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="h-9 w-full rounded-md border px-3 text-sm"
            >
              <option value="">
                Use server environment ({initial.envProvider})
              </option>
              <option value="stub">Stub (log only, no real SMS)</option>
              <option value="twilio">Twilio</option>
              <option value="telnyx">Telnyx</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="smsFromNumber">From number</Label>
            <Input
              id="smsFromNumber"
              name="smsFromNumber"
              defaultValue={initial.smsFromNumber}
              placeholder="+15551234567"
              disabled={provider !== "twilio" && provider !== "telnyx"}
            />
          </div>
        </div>

        {provider === "twilio" && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smsAccountSid">Twilio Account SID</Label>
              <Input
                id="smsAccountSid"
                name="smsAccountSid"
                defaultValue={initial.smsAccountSid}
                placeholder="ACxxxxxxxxxxxxxxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smsAuthToken">Auth token</Label>
              <Input
                id="smsAuthToken"
                name="smsAuthToken"
                type="password"
                placeholder={
                  initial.hasAuthToken
                    ? "Configured — leave blank to keep"
                    : "Required"
                }
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Stored encrypted (AES-256-GCM) and never shown again.
              </p>
            </div>
          </div>
        )}

        {provider === "telnyx" && (
          <div className="space-y-2">
            <Label htmlFor="smsAuthToken">Telnyx API key</Label>
            <Input
              id="smsAuthToken"
              name="smsAuthToken"
              type="password"
              placeholder={
                initial.hasAuthToken
                  ? "Configured — leave blank to keep"
                  : "Required (KEY…)"
              }
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Stored encrypted (AES-256-GCM) and never shown again. Delivery
              receipts are not tracked for Telnyx — sends are confirmed, but
              statuses stay at &ldquo;sent&rdquo;.
            </p>
          </div>
        )}

        <div className="space-y-3 rounded-md border p-3">
          <p className="text-sm font-medium">Scheduled reminders (worker)</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="dueSoonRemindersEnabled"
              defaultChecked={initial.dueSoonRemindersEnabled}
            />
            Send “rent due soon” reminders
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="overdueRemindersEnabled"
              defaultChecked={initial.overdueRemindersEnabled}
            />
            Send overdue reminders (after the grace period)
          </label>
          <div className="space-y-2">
            <Label htmlFor="reminderDueSoonDays">
              Days before the due date to send “due soon”
            </Label>
            <Input
              id="reminderDueSoonDays"
              name="reminderDueSoonDays"
              type="number"
              min={0}
              max={28}
              defaultValue={initial.reminderDueSoonDays}
              placeholder={`Server default (${initial.envDueSoonDays})`}
              className="w-48"
            />
          </div>
        </div>

        <div className="space-y-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">Message templates</p>
            <p className="text-xs text-muted-foreground">
              Leave a template blank to use the built-in default. {VARS_HINT}
            </p>
          </div>
          {initial.templates.map((t) => (
            <div key={t.type} className="space-y-2">
              <Label htmlFor={`tpl_${t.type}`}>{t.label}</Label>
              <textarea
                id={`tpl_${t.type}`}
                name={`tpl_${t.type}`}
                defaultValue={t.value}
                placeholder={t.defaultBody}
                rows={3}
                maxLength={480}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
          ))}
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save messaging settings"}
        </Button>
      </form>

      <form action={testAction} className="space-y-3 rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Send a test SMS</p>
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
            <Label htmlFor="testPhone">Phone number</Label>
            <Input
              id="testPhone"
              name="testPhone"
              placeholder="+15551234567"
              className="w-56"
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
