"use client";

import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  invitePortalAccountAction,
  setPortalAccountActiveAction,
  type PortalInviteState,
} from "../actions";

export interface PortalAccountSummary {
  exists: boolean;
  isActive: boolean;
  hasPassword: boolean;
  invitePending: boolean;
  lastLoginAt: string | null; // pre-formatted display string
  email: string | null;
  phone: string | null;
}

/**
 * Staff card on the tenant page: invite the tenant to the portal, re-send the
 * link (doubles as a password reset), and enable/disable their login.
 * Rendered only when the tenantPortal module is on and the viewer has
 * portal.manage.
 */
export function PortalAccessCard({
  tenantId,
  account,
}: {
  tenantId: string;
  account: PortalAccountSummary;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState<
    PortalInviteState,
    FormData
  >(invitePortalAccountAction, {});
  const [activeState, activeAction, activePending] = useActionState<
    PortalInviteState,
    FormData
  >(setPortalAccountActiveAction, {});

  const error = inviteState.error ?? activeState.error;
  const message = inviteState.ok
    ? inviteState.message
    : activeState.ok
      ? activeState.message
      : null;

  const status = !account.exists
    ? { label: "No account", variant: "outline" as const }
    : !account.isActive
      ? { label: "Disabled", variant: "outline" as const }
      : account.hasPassword
        ? { label: "Active", variant: "default" as const }
        : account.invitePending
          ? { label: "Invite pending", variant: "outline" as const }
          : { label: "Invite expired", variant: "outline" as const };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Tenant portal access</CardTitle>
        <Badge variant={status.variant}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
        {inviteState.link && (
          <p className="break-all rounded-md border bg-muted/30 p-2 font-mono text-xs">
            {inviteState.link}
          </p>
        )}

        <p className="text-sm text-muted-foreground">
          {account.exists ? (
            <>
              Signs in with{" "}
              {[account.email, account.phone && `phone ${account.phone}`]
                .filter(Boolean)
                .join(" or ") || "—"}
              {account.lastLoginAt
                ? ` · last sign-in ${account.lastLoginAt}`
                : " · never signed in"}
              .
            </>
          ) : (
            "Send an invite link (text + email) so this tenant can see their lease, balance, payments, and receipts, and submit requests."
          )}
        </p>

        <div className="flex flex-wrap gap-2">
          <form action={inviteAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <Button type="submit" size="sm" disabled={invitePending}>
              {invitePending
                ? "Sending…"
                : account.exists
                  ? "Re-send link (reset password)"
                  : "Invite to portal"}
            </Button>
          </form>
          {account.exists && (
            <form action={activeAction}>
              <input type="hidden" name="tenantId" value={tenantId} />
              <input
                type="hidden"
                name="isActive"
                value={account.isActive ? "false" : "true"}
              />
              <Button type="submit" variant="outline" size="sm" disabled={activePending}>
                {activePending
                  ? "Saving…"
                  : account.isActive
                    ? "Disable login"
                    : "Enable login"}
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
