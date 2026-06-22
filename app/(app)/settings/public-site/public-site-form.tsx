"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/forms";
import { savePublicSiteAction } from "./actions";

export interface PublicSiteInitial {
  publicSiteUrl: string;
  publicSiteTagline: string;
  publicSiteIntro: string;
  publicSiteAreas: string;
  publicSiteHours: string;
  /** Whether the publicSite module is on (drives the live/draft hint). */
  enabled: boolean;
  businessName: string;
}

const TEXTAREA_CLASS = "w-full rounded-md border p-2 text-sm";

export function PublicSiteForm({ initial }: { initial: PublicSiteInitial }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePublicSiteAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <AlertDescription>Public site settings saved.</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        The public marketing splash for {initial.businessName}. Your logo, name, brand color, and
        contact details come from{" "}
        <Link href="/settings/organization" className="text-primary underline underline-offset-2">
          Organization
        </Link>
        ; privacy &amp; terms come from{" "}
        <Link href="/settings/messaging" className="text-primary underline underline-offset-2">
          Messaging → Compliance
        </Link>
        .{" "}
        {initial.enabled ? (
          <span className="font-medium text-foreground">The public site is live.</span>
        ) : (
          <>
            It is <span className="font-medium text-foreground">not live yet</span> — turn on the
            “Public website” module in{" "}
            <Link href="/settings/modules" className="text-primary underline underline-offset-2">
              Modules
            </Link>{" "}
            when you&apos;re ready.
          </>
        )}
      </p>

      <div className="space-y-2">
        <Label htmlFor="publicSiteUrl">Public site address</Label>
        <Input
          id="publicSiteUrl"
          name="publicSiteUrl"
          type="url"
          inputMode="url"
          placeholder="https://newedgerentals.com"
          defaultValue={initial.publicSiteUrl}
        />
        <p className="text-xs text-muted-foreground">
          The address residents use. Tenant-portal invite &amp; password-reset links point here
          (e.g. <span className="font-mono">https://newedgerentals.com/portal</span>); leave blank
          to use the staff address. Set this once DNS + your reverse proxy route the domain to the
          app (see docs/PUBLIC_SITE.md).
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="publicSiteTagline">Headline</Label>
        <Input
          id="publicSiteTagline"
          name="publicSiteTagline"
          placeholder={`Welcome to ${initial.businessName}`}
          defaultValue={initial.publicSiteTagline}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="publicSiteIntro">Intro blurb</Label>
        <textarea
          id="publicSiteIntro"
          name="publicSiteIntro"
          rows={3}
          className={TEXTAREA_CLASS}
          placeholder="A sentence or two about who you are and what you offer."
          defaultValue={initial.publicSiteIntro}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="publicSiteAreas">Areas we serve</Label>
          <textarea
            id="publicSiteAreas"
            name="publicSiteAreas"
            rows={4}
            className={TEXTAREA_CLASS}
            placeholder={"Somerset\nNew Brunswick\nFranklin Township"}
            defaultValue={initial.publicSiteAreas}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="publicSiteHours">Office hours</Label>
          <textarea
            id="publicSiteHours"
            name="publicSiteHours"
            rows={4}
            className={TEXTAREA_CLASS}
            placeholder={"Mon–Fri: 9am–5pm\nSat: by appointment\nSun: closed"}
            defaultValue={initial.publicSiteHours}
          />
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save public site"}
      </Button>
    </form>
  );
}
