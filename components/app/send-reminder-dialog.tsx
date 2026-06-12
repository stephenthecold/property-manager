"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  sendReminderAction,
  type SendReminderState,
} from "@/app/(app)/reminders/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

const REMINDER_TYPES = [
  "rent_due_soon",
  "rent_overdue",
  "partial_balance",
  "payment_receipt",
  "manual",
] as const;

export function SendReminderDialog({
  tenantId,
  leaseId,
  tenantName,
  hasConsent,
  hasPhone,
  defaultBodies,
}: {
  tenantId: string;
  leaseId?: string;
  tenantName: string;
  hasConsent: boolean;
  hasPhone: boolean;
  /** Pre-rendered template previews per reminder type (built server-side). */
  defaultBodies: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>("rent_due_soon");
  const [state, formAction, pending] = useActionState<SendReminderState, FormData>(
    sendReminderAction,
    {},
  );

  const blocked = !hasConsent || !hasPhone;

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      const t = setTimeout(() => setOpen(false), 800);
      return () => clearTimeout(t);
    }
  }, [state.ok, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Send reminder</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send SMS reminder</DialogTitle>
          <DialogDescription>
            Text {tenantName} about their rent.
          </DialogDescription>
        </DialogHeader>
        {blocked ? (
          <Alert variant="destructive">
            <AlertDescription>
              {!hasConsent
                ? `${tenantName} has not given SMS consent, so sending is blocked. Record their consent on the tenant record first.`
                : `${tenantName} has no phone number on file, so sending is blocked. Add a phone number to the tenant record first.`}
            </AlertDescription>
          </Alert>
        ) : (
          <form action={formAction} className="space-y-4">
            <input type="hidden" name="tenantId" value={tenantId} />
            {leaseId && <input type="hidden" name="leaseId" value={leaseId} />}
            <div className="space-y-2">
              <Label htmlFor="reminderType">Reminder type</Label>
              <select
                id="reminderType"
                name="reminderType"
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {REMINDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            {type === "manual" ? (
              <div className="space-y-2">
                <Label htmlFor="messageBody">Message</Label>
                <textarea
                  id="messageBody"
                  name="messageBody"
                  maxLength={480}
                  required
                  placeholder="Type the SMS to send…"
                  className="min-h-24 w-full rounded-md border p-2 text-sm"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label>Message preview</Label>
                <pre className="rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
                  {defaultBodies[type] ?? ""}
                </pre>
              </div>
            )}
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
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Sending…" : "Send SMS"}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
