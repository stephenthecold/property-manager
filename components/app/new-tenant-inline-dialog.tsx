"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createTenantInline,
  type InlineTenantState,
} from "@/app/(app)/tenants/actions";
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
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Create a brand-new tenant WITHOUT leaving the lease-creation form. On success
 * it hands the created tenant back to the parent (which appends it to the
 * picker and selects it) and closes — it does not navigate, unlike the full
 * "Add tenant" page. The dialog content is portaled, so its `<form>` is not
 * nested inside the lease form; the trigger is `type="button"` so it never
 * submits that outer form.
 */
export function NewTenantInlineDialog({
  onCreated,
}: {
  onCreated: (tenant: { id: string; label: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<InlineTenantState, FormData>(
    createTenantInline,
    {},
  );

  useEffect(() => {
    if (!state.ok || !state.tenant) return;
    const created = state.tenant;
    // Defer out of the effect body (no synchronous setState in an effect — it
    // can cascade renders), matching record-payment-dialog. Closing the dialog
    // also stops this from re-running for the same result.
    const t = setTimeout(() => {
      onCreated(created);
      setOpen(false);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, state.tenant]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        New tenant
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>
            Adds a tenant and selects them for this lease. Fill in the rest of their details
            later from the tenant page.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="newTenantFirst">First name</Label>
              <Input id="newTenantFirst" name="firstName" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newTenantLast">Last name</Label>
              <Input id="newTenantLast" name="lastName" required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="newTenantPhone">Phone</Label>
              <Input id="newTenantPhone" name="phone" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newTenantEmail">Email</Label>
              <Input id="newTenantEmail" name="email" type="email" />
            </div>
          </div>
          {state.error && (
            <Alert variant="destructive">
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? "Creating…" : "Create & select"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
