"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addManualChargeAction,
  type ManualChargeState,
} from "@/app/(app)/tenants/[id]/manual-charge-actions";
import {
  MANUAL_CHARGE_CATEGORIES,
  MANUAL_CHARGE_SPECS,
  type ManualChargeCategory,
} from "@/lib/accounting/manual-charge";
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
 * Staff control to post a one-off charge/credit to a lease ledger (deposits, a
 * missed move-in prorate, other charges, credits). Mirrors the record-payment
 * dialog: a client-minted idempotency key (re-minted per open) makes a
 * double-submit safe, and it stays open on a server validation error.
 */
export function ManualChargeDialog({
  leaseId,
  tenantId,
  depositSuggestion,
  prorateSuggestion,
  today,
}: {
  leaseId: string;
  tenantId: string;
  /** Lease security deposit as a dollar string ("1500.00"), or null. */
  depositSuggestion: string | null;
  /** Computed move-in prorate as a dollar string, or null when not mid-period. */
  prorateSuggestion: string | null;
  /** Today as yyyy-MM-dd — the default effective date. */
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idemKey, setIdemKey] = useState("");
  const [category, setCategory] = useState<ManualChargeCategory>("security_deposit");
  const [amount, setAmount] = useState(depositSuggestion ?? "");
  const [state, formAction, pending] = useActionState<ManualChargeState, FormData>(
    addManualChargeAction,
    {},
  );

  // Prefill the amount from the chosen category's suggestion (deposit / move-in
  // prorate); leave a typed value alone for categories without one. Done in the
  // change handler — not an effect — to avoid set-state-in-effect churn.
  function pickCategory(next: ManualChargeCategory) {
    setCategory(next);
    if (next === "security_deposit" && depositSuggestion) setAmount(depositSuggestion);
    else if (next === "prorated_rent" && prorateSuggestion) setAmount(prorateSuggestion);
  }

  function handleOpenChange(next: boolean) {
    if (next && !idemKey) setIdemKey(crypto.randomUUID());
    if (next) {
      setCategory("security_deposit");
      setAmount(depositSuggestion ?? "");
    }
    setOpen(next);
  }

  useEffect(() => {
    if (!state.ok) return;
    router.refresh();
    const t = setTimeout(() => {
      setOpen(false);
      setIdemKey("");
    }, 900);
    return () => clearTimeout(t);
  }, [state.ok, router]);

  const spec = MANUAL_CHARGE_SPECS[category];
  const hint =
    spec.sign === -1
      ? "Reduces the tenant's balance. Not counted as income."
      : category === "prorated_rent"
        ? "Adds to the balance and counts as rent in reports."
        : "Adds to the tenant's balance. Not counted as income (deposits/charges).";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        Add charge or credit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a charge or credit</DialogTitle>
          <DialogDescription>
            Posts a one-off entry to this lease&apos;s ledger — a deposit, a missed
            move-in prorate, or a credit/concession. Append-only and audited; reverse
            it from the ledger if it&apos;s wrong.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="leaseId" value={leaseId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="idempotencyKey" value={idemKey} />
          <div className="space-y-2">
            <Label htmlFor="mc-category">Type</Label>
            <select
              id="mc-category"
              name="category"
              value={category}
              onChange={(e) => pickCategory(e.target.value as ManualChargeCategory)}
              className="h-9 w-full rounded-md border px-3 text-sm"
            >
              {MANUAL_CHARGE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {MANUAL_CHARGE_SPECS[c].label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mc-amount">Amount</Label>
            <Input
              id="mc-amount"
              name="amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
            <p className="text-xs text-muted-foreground">{hint}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mc-date">Effective date</Label>
            <Input id="mc-date" name="effectiveDate" type="date" defaultValue={today} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mc-note">Note (optional)</Label>
            <Textarea
              id="mc-note"
              name="note"
              placeholder="Shown on the ledger and the audit log"
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
            {pending ? "Posting…" : "Post entry"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
