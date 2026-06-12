"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { emailReceiptAction, type ReceiptEmailState } from "../actions";

/**
 * One-click "email this receipt to the tenant". Sends through the configured
 * email provider (Settings → Messaging) and marks the receipt sent via email.
 */
export function EmailReceiptButton({
  receiptId,
  tenantEmail,
}: {
  receiptId: string;
  tenantEmail: string | null;
}) {
  const [state, formAction, pending] = useActionState<ReceiptEmailState, FormData>(
    emailReceiptAction,
    {},
  );

  if (!tenantEmail) {
    return (
      <span className="text-xs text-muted-foreground">
        No tenant email on file
      </span>
    );
  }
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="receiptId" value={receiptId} />
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Emailing…" : "Email to tenant"}
      </Button>
      {state.error && (
        <span className="text-sm text-destructive">{state.error}</span>
      )}
      {state.ok && (
        <span className="text-sm text-muted-foreground">{state.message}</span>
      )}
    </form>
  );
}
