"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStatusAction, sendLinkAction, type AppActionState } from "./actions";

const STATUS_OPTIONS = [
  "submitted",
  "reviewing",
  "approved",
  "declined",
  "withdrawn",
] as const;

/** Status + reviewer-notes editor on the application detail page. */
export function StatusForm({
  id,
  currentStatus,
  reviewerNotes,
  canConvert,
}: {
  id: string;
  currentStatus: string;
  reviewerNotes: string;
  canConvert: boolean;
}) {
  const [state, action, pending] = useActionState<AppActionState, FormData>(
    setStatusAction,
    {},
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
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
      <div className="space-y-2">
        <Label htmlFor="status">Status</Label>
        <select
          id="status"
          name="status"
          defaultValue={currentStatus}
          className="h-9 w-full max-w-xs rounded-md border px-3 text-sm capitalize"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="reviewerNotes">Reviewer notes (staff only)</Label>
        <textarea
          id="reviewerNotes"
          name="reviewerNotes"
          defaultValue={reviewerNotes}
          rows={3}
          className="w-full rounded-md border p-2 text-sm"
        />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save status"}
      </Button>
      {canConvert && (
        <p className="text-xs text-muted-foreground">
          Use “Convert to tenant” to create a tenant record from this applicant.
        </p>
      )}
    </form>
  );
}

/** Email/text the public apply link to a prospect. */
export function SendLinkForm({ unitId }: { unitId?: string | null }) {
  const [state, action, pending] = useActionState<AppActionState, FormData>(
    sendLinkAction,
    {},
  );
  return (
    <form action={action} className="space-y-3">
      {unitId && <input type="hidden" name="unitId" value={unitId} />}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sl-email">Email</Label>
          <Input id="sl-email" name="email" type="email" placeholder="prospect@example.com" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sl-phone">Phone</Label>
          <Input id="sl-phone" name="phone" type="tel" placeholder="+15551234567" />
        </div>
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Sending…" : "Send apply link"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Sends a link to the public application form via your configured email/SMS
        provider. Fill either field, or both.
      </p>
    </form>
  );
}
