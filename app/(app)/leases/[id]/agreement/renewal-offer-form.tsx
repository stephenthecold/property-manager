"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createRenewalOfferAction } from "./actions";

const TERMS = [6, 12, 18, 24];
const BUMPS = [0, 3, 5];

/**
 * Propose new renewal terms. The rent input prefills from the current rent; the
 * quick-bump buttons set it to a +% of the current rent (a small-operator
 * shortcut). Submits to the server action, which renders the e-sign document
 * with these terms and sends it to the tenant(s).
 */
export function RenewalOfferForm({
  leaseId,
  currentRentDollars,
}: {
  leaseId: string;
  currentRentDollars: string;
}) {
  const base = Number(currentRentDollars) || 0;
  const [rent, setRent] = React.useState(currentRentDollars);

  return (
    <form action={createRenewalOfferAction} className="space-y-3">
      <input type="hidden" name="leaseId" value={leaseId} />
      <div className="space-y-1.5">
        <Label htmlFor="renewalModel">Renewal type</Label>
        <select
          id="renewalModel"
          name="renewalModel"
          defaultValue="extend"
          className="h-9 w-full rounded-md border px-3 text-sm sm:max-w-md"
        >
          <option value="extend">Extend this lease — same lease, new term + rent</option>
          <option value="successor">
            New lease — replaces this one when its term ends
          </option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="proposedRent">New monthly rent</Label>
          <Input
            id="proposedRent"
            name="proposedRent"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            inputMode="decimal"
            className="w-full"
          />
          <div className="flex flex-wrap gap-1.5">
            {BUMPS.map((p) => (
              <Button
                key={p}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => setRent((base * (1 + p / 100)).toFixed(2))}
              >
                {p === 0 ? "Keep current" : `+${p}%`}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="termMonths">Renewal term</Label>
          <select
            id="termMonths"
            name="termMonths"
            defaultValue="12"
            className="h-9 w-full rounded-md border px-3 text-sm"
          >
            {TERMS.map((m) => (
              <option key={m} value={m}>
                {m} months
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" size="sm">
        Send renewal offer
      </Button>
    </form>
  );
}
