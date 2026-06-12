"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  recordPayment,
  type RecordPaymentState,
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

const METHODS = ["cash", "check", "money_order", "card", "ach", "online", "cash_app", "other"];

export interface LeaseOption {
  id: string;
  /** Option text, e.g. "Unit 2B — Last, First". */
  label: string;
  /** Optgroup label (property name). */
  group: string;
}

type RecordPaymentDialogProps = {
  defaultAmount?: string;
  trigger?: string;
  /** Small outline trigger for table rows (e.g. the dashboard Collect button). */
  compact?: boolean;
} & (
  | {
      /** Fixed lease: the dialog posts to this lease (dashboard/tenant pages). */
      leaseId: string;
      leaseOptions?: never;
    }
  | {
      leaseId?: never;
      /** No fixed lease: render a required lease picker grouped by property. */
      leaseOptions: LeaseOption[];
    }
);

export function RecordPaymentDialog({
  leaseId,
  leaseOptions,
  defaultAmount,
  trigger = "Record payment",
  compact = false,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Client-minted idempotency key: a double-submit reuses the same key (no double charge).
  const [idemKey, setIdemKey] = useState<string>("");
  const [state, formAction, pending] = useActionState<RecordPaymentState, FormData>(
    recordPayment,
    {},
  );

  function handleOpenChange(next: boolean) {
    // Mint a fresh idempotency key when opening (a double-submit reuses it).
    if (next && !idemKey) setIdemKey(crypto.randomUUID());
    setOpen(next);
  }

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      // When a receipt link is shown, stay open so it can be clicked; the user
      // closes the dialog manually. The form stays live, so mint the next
      // payment's key NOW — a blank key would fail any further submit.
      if (state.receiptId) {
        setIdemKey(crypto.randomUUID());
        return;
      }
      const t = setTimeout(() => {
        setOpen(false);
        setIdemKey(""); // fresh key for the next payment
      }, 900);
      return () => clearTimeout(t);
    }
  }, [state.ok, state.receiptId, router]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            variant={compact ? "outline" : "default"}
            size={compact ? "sm" : "default"}
          >
            {trigger}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Applied to open charges oldest-first. Overpayment becomes tenant credit.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {leaseId ? (
            <input type="hidden" name="leaseId" value={leaseId} />
          ) : (
            <div className="space-y-2">
              <Label htmlFor="leaseId">Lease</Label>
              <select
                id="leaseId"
                name="leaseId"
                required
                defaultValue=""
                className="h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="" disabled>
                  Select a lease…
                </option>
                {groupLeaseOptions(leaseOptions ?? []).map(([group, options]) => (
                  <optgroup key={group} label={group}>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          <input type="hidden" name="idempotencyKey" value={idemKey} />
          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              defaultValue={defaultAmount}
              placeholder="1200.00"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="paymentDate">Date</Label>
              <Input id="paymentDate" name="paymentDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">Method</Label>
              <select
                id="method"
                name="method"
                className="h-9 w-full rounded-md border px-3 text-sm capitalize"
              >
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="referenceNumber">Reference / check #</Label>
            <Input id="referenceNumber" name="referenceNumber" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" name="notes" />
          </div>
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          {state.ok && (
            <Alert>
              <AlertDescription>
                {state.message}
                {state.receiptId && state.receiptNumber && (
                  <>
                    {" "}
                    <a href={`/receipts/${state.receiptId}`}>
                      View receipt {state.receiptNumber}
                    </a>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Recording…" : "Record payment"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Group options by property name, preserving the caller's sort order. */
function groupLeaseOptions(options: LeaseOption[]): [string, LeaseOption[]][] {
  const groups = new Map<string, LeaseOption[]>();
  for (const o of options) {
    const list = groups.get(o.group);
    if (list) list.push(o);
    else groups.set(o.group, [o]);
  }
  return [...groups.entries()];
}
