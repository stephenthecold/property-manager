"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  reverseManualEntryAction,
  type ManualChargeState,
} from "@/app/(app)/tenants/[id]/manual-charge-actions";
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
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Per-row "Reverse" control for a manually-posted ledger entry. Appends an
 * offsetting reversal (the original stays on the ledger); stays open on a
 * server-side error and closes on success.
 */
export function ReverseManualEntryDialog({
  entryId,
  tenantId,
  entryLabel,
  amountFormatted,
}: {
  entryId: string;
  tenantId: string;
  /** Short description of the entry, for the dialog copy. */
  entryLabel: string;
  amountFormatted: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<ManualChargeState, FormData>(
    reverseManualEntryAction,
    {},
  );

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    const t = setTimeout(() => setOpen(false), 900);
    return () => clearTimeout(t);
  }, [state.ok, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Reverse</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reverse this entry</DialogTitle>
          <DialogDescription>
            Appends an offsetting reversal for {entryLabel} ({amountFormatted}). The
            original stays on the ledger and the audit log records who reversed it and
            why — nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="entryId" value={entryId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <div className="space-y-2">
            <Label htmlFor={`rev-reason-${entryId}`}>Reason</Label>
            <Textarea
              id={`rev-reason-${entryId}`}
              name="reason"
              placeholder="Why this entry is being reversed (kept on the audit log)"
              required
            />
          </div>
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
          <Button type="submit" variant="destructive" disabled={pending} className="w-full">
            {pending ? "Reversing…" : "Reverse entry"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
