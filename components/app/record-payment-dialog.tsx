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

const METHODS = ["cash", "check", "money_order", "card", "ach", "online", "other"];

export function RecordPaymentDialog({
  leaseId,
  defaultAmount,
}: {
  leaseId: string;
  defaultAmount?: string;
}) {
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
      <DialogTrigger render={<Button>Record payment</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Applied to open charges oldest-first. Overpayment becomes tenant credit.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="leaseId" value={leaseId} />
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
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm capitalize"
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
