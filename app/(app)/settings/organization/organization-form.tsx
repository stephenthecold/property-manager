"use client";

import { useActionState, useState } from "react";
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
  brandColor: string;
  receiptFooter: string;
  receiptPrefix: string;
  portalWelcomeText: string;
  applyIntroText: string;
  portalPaymentHelpText: string;
  applyConfirmationText: string;
  reportHeaderText: string;
  defaultTablePageSize: number;
  defaultTimezone: string;
  defaultCurrency: string;
  logoUrl: string | null;
}

const LOGO_MAX_BYTES = 2 * 1024 * 1024; // keep in sync with actions.ts

export function OrganizationForm({ initial }: { initial: OrganizationInitial }) {
  const router = useRouter();
  const [logoError, setLogoError] = useState<string | null>(null);
  const [brandColor, setBrandColor] = useState(initial.brandColor);
  const brandSwatch = /^#[0-9a-fA-F]{6}$/.test(brandColor.trim())
    ? brandColor.trim()
    : "#2563eb";
  const [state, formAction, pending] = useActionState<OrganizationState, FormData>(
    async (prev, fd) => {
      const next = await saveOrganizationAction(prev, fd);
      if (next.ok) router.refresh();
      return next;
    },
    {},
  );

  return (
    <form
      action={formAction}
      // Block oversized logos client-side: past the server-action body cap
      // the framework rejects the POST with a bare 413 before our validation
      // can answer with a friendly message.
      onSubmit={(e) => {
        if (logoError) e.preventDefault();
      }}
      className="space-y-4"
    >
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
        <Input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            setLogoError(
              f && f.size > LOGO_MAX_BYTES
                ? `Logo is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 2 MB. Please resize or compress it.`
                : null,
            );
          }}
        />
        {logoError && <p className="text-sm text-destructive">{logoError}</p>}
        <p className="text-xs text-muted-foreground">
          PNG, JPEG, or WebP, max 2 MB. Appears on printable receipts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="brandColor">Brand colour</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Brand colour picker"
              value={brandSwatch}
              onChange={(e) => setBrandColor(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border p-1"
            />
            <Input
              id="brandColor"
              name="brandColor"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              placeholder="#2563eb"
              className="flex-1"
            />
            {brandColor.trim() !== "" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBrandColor("")}
              >
                Reset
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Recolours buttons, links, and highlights — the colour&rsquo;s hue is
            applied to both light and dark themes (contrast is preserved). Blank
            uses the default theme.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="receiptPrefix">Receipt number prefix</Label>
          <Input
            id="receiptPrefix"
            name="receiptPrefix"
            defaultValue={initial.receiptPrefix}
            placeholder="RCT"
            maxLength={8}
          />
          <p className="text-xs text-muted-foreground">
            Letters/digits only (max 8). Receipts are numbered{" "}
            <code>{initial.receiptPrefix || "RCT"}-YYYYMMDD-0001</code>. Blank uses{" "}
            <code>RCT</code>. Existing receipt numbers are never changed.
          </p>
        </div>
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
          <Label htmlFor="portalWelcomeText">Tenant portal welcome text</Label>
          <textarea
            id="portalWelcomeText"
            name="portalWelcomeText"
            defaultValue={initial.portalWelcomeText}
            rows={2}
            className="w-full rounded-md border p-2 text-sm"
            placeholder="Welcome to your tenant portal. View your balance and pay rent here."
          />
          <p className="text-xs text-muted-foreground">
            Shown on the tenant portal home. Blank uses the default copy.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="applyIntroText">Rental application intro text</Label>
          <textarea
            id="applyIntroText"
            name="applyIntroText"
            defaultValue={initial.applyIntroText}
            rows={2}
            className="w-full rounded-md border p-2 text-sm"
            placeholder="Tell us about yourself and we'll be in touch."
          />
          <p className="text-xs text-muted-foreground">
            Shown atop the public application form. Blank uses the default copy.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="applyConfirmationText">Application confirmation text</Label>
          <textarea
            id="applyConfirmationText"
            name="applyConfirmationText"
            defaultValue={initial.applyConfirmationText}
            rows={2}
            className="w-full rounded-md border p-2 text-sm"
            placeholder="Thanks! Your application has been submitted. We'll be in touch."
          />
          <p className="text-xs text-muted-foreground">
            Shown after an applicant submits the public form. Blank uses the default copy.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="portalPaymentHelpText">Tenant portal &ldquo;how to pay&rdquo; text</Label>
          <textarea
            id="portalPaymentHelpText"
            name="portalPaymentHelpText"
            defaultValue={initial.portalPaymentHelpText}
            rows={2}
            className="w-full rounded-md border p-2 text-sm"
            placeholder="Pay rent by bank transfer to… or in person at…"
          />
          <p className="text-xs text-muted-foreground">
            Shown on the tenant portal home. Blank hides the panel.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reportHeaderText">Report &amp; receipt header text</Label>
        <textarea
          id="reportHeaderText"
          name="reportHeaderText"
          defaultValue={initial.reportHeaderText}
          rows={2}
          className="w-full rounded-md border p-2 text-sm"
          placeholder="Remit to: 123 Main St · Questions? billing@example.com"
        />
        <p className="text-xs text-muted-foreground">
          Printed atop reports and receipts (e.g. a &ldquo;remit to&rdquo; block). Blank shows nothing.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="defaultTablePageSize">Default rows per page</Label>
          <select
            id="defaultTablePageSize"
            name="defaultTablePageSize"
            defaultValue={String(initial.defaultTablePageSize)}
            className="h-9 w-full rounded-md border px-2 text-sm"
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Initial page size for tables across the app. Each table&rsquo;s own
            selector still overrides it per view.
          </p>
        </div>

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
