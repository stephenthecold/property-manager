"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  writeOffBalanceAction,
  type WriteOffBalanceState,
} from "@/app/(app)/payments/actions";
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
 * "Write off balance" control for a terminated lease still owing back rent.
 * Forgives the FULL outstanding balance via append-only reversal entries (the
 * originals stay on the ledger). Like {@link WaiveChargeDialog}, it stays open
 * on a server-side validation error and closes only on success.
 */
export function WriteOffBalanceDialog({
  leaseId,
  owedFormatted,
  unitLabel,
}: {
  leaseId: string;
  /** Outstanding balance formatted for display, e.g. "$2,000.00". */
  owedFormatted: string;
  /** Property · unit label, for the dialog copy. */
  unitLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<WriteOffBalanceState, FormData>(
    writeOffBalanceAction,
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
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Write off balance
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write off back rent</DialogTitle>
          <DialogDescription>
            Forgives the full outstanding balance on {unitLabel} as bad debt. This appends
            offsetting reversal entries — the original charges stay on the ledger and the audit
            log records who did it and why. Nothing is deleted; if the tenant later pays, you can
            still record it.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="leaseId" value={leaseId} />
          <div>
            <div className="text-xs text-muted-foreground">Amount to write off</div>
            <div className="text-lg font-semibold tabular-nums">{owedFormatted}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`writeoffReason-${leaseId}`}>Reason</Label>
            <Textarea
              id={`writeoffReason-${leaseId}`}
              name="reason"
              placeholder="Why this back rent is being written off (kept on the ledger and audit log)"
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
            {pending ? "Writing off…" : "Write off balance"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
