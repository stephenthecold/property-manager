"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  waiveChargeAction,
  type WaiveChargeState,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * "Waive" control for an open charge row in the ledger. Appends an offsetting
 * reversal entry (full or partial) — the original charge is never mutated.
 * Unlike FormDialog (which closes on any valid submit), this dialog stays open
 * on server-side validation errors and closes only on success.
 */
export function WaiveChargeDialog({
  entryId,
  chargeLabel,
  periodLabel,
  outstanding,
  outstandingFormatted,
}: {
  /** Ledger entry id of the charge. */
  entryId: string;
  /** e.g. "Rent charge" or "Late fee". */
  chargeLabel: string;
  /** Period key or em dash. */
  periodLabel: string;
  /** Outstanding as a decimal string (prefills the amount input). */
  outstanding: string;
  /** Outstanding formatted for display, e.g. "$1,200.00". */
  outstandingFormatted: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<WaiveChargeState, FormData>(
    waiveChargeAction,
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
      <DialogTrigger render={<Button variant="outline" size="xs" />}>
        Waive
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Waive charge</DialogTitle>
          <DialogDescription>
            Appends an offsetting reversal — the original entry stays in the
            ledger. The waived portion stops aging, overdue reminders, and
            late-fee accrual.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Charge</div>
            <div className="font-medium">{chargeLabel}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Period</div>
            <div className="font-medium tabular-nums">{periodLabel}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Outstanding</div>
            <div className="font-medium tabular-nums">{outstandingFormatted}</div>
          </div>
        </div>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="entryId" value={entryId} />
          <div className="space-y-2">
            <Label htmlFor={`waiveAmount-${entryId}`}>Amount to waive</Label>
            <Input
              id={`waiveAmount-${entryId}`}
              name="amount"
              inputMode="decimal"
              defaultValue={outstanding}
              required
            />
            <p className="text-xs text-muted-foreground">
              Up to {outstandingFormatted}; a smaller amount is a partial waive.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`waiveReason-${entryId}`}>Reason</Label>
            <Textarea
              id={`waiveReason-${entryId}`}
              name="reason"
              placeholder="Why this charge is being waived (kept on the ledger and audit log)"
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
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Waiving…" : "Waive charge"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
