"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  createTrialLinkAction,
  impersonateTenantAction,
  type PortalInviteState,
} from "@/app/(app)/tenants/actions";

export interface ImpersonateTenantOption {
  id: string;
  name: string;
}

/**
 * Settings-menu entry point for impersonation: pick any active tenant, then
 * either open the portal as them now or generate a single-use trial-login link.
 * Reuses the same audited, capability-gated actions as the per-tenant card.
 */
export function SettingsImpersonatePanel({
  tenants,
}: {
  tenants: ImpersonateTenantOption[];
}) {
  const [selected, setSelected] = useState(tenants[0]?.id ?? "");
  const [trialState, trialAction, trialPending] = useActionState<
    PortalInviteState,
    FormData
  >(createTrialLinkAction, {});

  if (tenants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No active tenants to impersonate yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="imp-tenant">Tenant</Label>
        <select
          id="imp-tenant"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {trialState.error && (
        <Alert variant="destructive">
          <AlertDescription>{trialState.error}</AlertDescription>
        </Alert>
      )}
      {trialState.ok && (
        <Alert>
          <AlertDescription>{trialState.message}</AlertDescription>
        </Alert>
      )}
      {trialState.link && (
        <p className="break-all rounded-md border bg-muted/30 p-2 font-mono text-xs">
          {trialState.link}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <form action={impersonateTenantAction}>
          <input type="hidden" name="tenantId" value={selected} />
          <Button type="submit" size="sm">
            Open portal as this tenant
          </Button>
        </form>
        <form action={trialAction}>
          <input type="hidden" name="tenantId" value={selected} />
          <Button type="submit" variant="outline" size="sm" disabled={trialPending}>
            {trialPending ? "Creating…" : "Create trial login link"}
          </Button>
        </form>
      </div>

      <p className="text-xs text-muted-foreground">
        “Open portal as this tenant” starts a 1-hour, audited session with an
        “impersonating” banner. The trial link is single-use and expires in 30
        minutes — open it in a private window to smoke-test cleanly.
      </p>
    </div>
  );
}
