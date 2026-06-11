"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Internet add-on inputs for the new-lease form, prefilled from the selected
 * unit's defaults. Listens to the (server-rendered) #unitId select directly so
 * the rest of the form can stay a server component; the operator can still
 * override both fields before submitting.
 */
export function LeaseInternetFields({
  unitDefaults,
  fallbackFee,
}: {
  unitDefaults: Record<string, { enabled: boolean; fee: string }>;
  fallbackFee: string;
}) {
  const [enabled, setEnabled] = useState(false);
  const [fee, setFee] = useState(fallbackFee);

  useEffect(() => {
    const sel = document.getElementById("unitId") as HTMLSelectElement | null;
    if (!sel) return;
    const apply = () => {
      const d = unitDefaults[sel.value];
      if (d) {
        setEnabled(d.enabled);
        setFee(d.fee);
      }
    };
    apply();
    sel.addEventListener("change", apply);
    return () => sel.removeEventListener("change", apply);
  }, [unitDefaults]);

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          id="leaseInternet"
          name="internetEnabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-4 accent-primary"
        />
        <Label htmlFor="leaseInternet">
          Internet service — add the monthly fee to this lease&apos;s rent charge
        </Label>
      </div>
      <div className="space-y-2">
        <Label htmlFor="internetFee">Monthly internet fee</Label>
        <Input
          id="internetFee"
          name="internetFee"
          inputMode="decimal"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          className="max-w-40"
        />
        <p className="text-xs text-muted-foreground">
          Prefilled from the selected unit&apos;s default; editable per lease.
        </p>
      </div>
    </div>
  );
}
