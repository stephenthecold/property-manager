"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  saveOrganizationAction,
  type OrganizationState,
} from "./actions";

export interface OrganizationInitial {
  businessName: string;
  businessLegalName: string;
  businessAddress: string;
  businessPhone: string;
  businessEmail: string;
  receiptFooter: string;
  defaultTimezone: string;
  defaultCurrency: string;
  logoUrl: string | null;
}

export function OrganizationForm({ initial }: { initial: OrganizationInitial }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<OrganizationState, FormData>(
    async (prev, fd) => {
      const next = await saveOrganizationAction(prev, fd);
      if (next.ok) router.refresh();
      return next;
    },
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="businessName">Business name</Label>
          <Input
            id="businessName"
            name="businessName"
            defaultValue={initial.businessName}
            placeholder="Property Manager"
          />
          <p className="text-xs text-muted-foreground">
            Shown in the app header, on receipts, and on printable reports.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="businessLegalName">Legal name (optional)</Label>
          <Input
            id="businessLegalName"
            name="businessLegalName"
            defaultValue={initial.businessLegalName}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="businessAddress">Business address</Label>
        <textarea
          id="businessAddress"
          name="businessAddress"
          defaultValue={initial.businessAddress}
          rows={3}
          className="w-full rounded-md border p-2 text-sm"
          placeholder={"123 Main St\nSpringfield, IL 62701"}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="businessPhone">Contact phone</Label>
          <Input id="businessPhone" name="businessPhone" defaultValue={initial.businessPhone} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="businessEmail">Contact email</Label>
          <Input id="businessEmail" name="businessEmail" defaultValue={initial.businessEmail} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="logo">Logo</Label>
        {initial.logoUrl && (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
            <img
              src={initial.logoUrl}
              alt="Current logo"
              className="h-12 max-w-40 rounded border bg-white object-contain p-1"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" name="removeLogo" /> Remove logo
            </label>
          </div>
        )}
        <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" />
        <p className="text-xs text-muted-foreground">
          PNG, JPEG, or WebP, max 2 MB. Appears on printable receipts.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="receiptFooter">Receipt footer text</Label>
        <textarea
          id="receiptFooter"
          name="receiptFooter"
          defaultValue={initial.receiptFooter}
          rows={2}
          className="w-full rounded-md border p-2 text-sm"
          placeholder="Thank you for your payment. Questions? Call us."
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="defaultTimezone">Default timezone (new properties)</Label>
          <Input
            id="defaultTimezone"
            name="defaultTimezone"
            defaultValue={initial.defaultTimezone}
            placeholder="America/New_York"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="defaultCurrency">Default currency (new properties)</Label>
          <Input
            id="defaultCurrency"
            name="defaultCurrency"
            defaultValue={initial.defaultCurrency}
            placeholder="USD"
            maxLength={3}
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save organization settings"}
      </Button>
    </form>
  );
}
