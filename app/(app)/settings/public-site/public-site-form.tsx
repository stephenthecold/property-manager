"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/forms";
import {
  addGalleryImagesAction,
  removeGalleryImageAction,
  savePublicSiteAction,
  savePublicSiteHeroAction,
} from "./actions";

export interface PublicSiteInitial {
  publicSiteUrl: string;
  publicSiteTagline: string;
  publicSiteIntro: string;
  publicSiteAreas: string;
  publicSiteHours: string;
  publicSiteAmenities: string;
  showAvailability: boolean;
  /** Whether the dedicated public /vacancies browse page is enabled. */
  showVacancies: boolean;
  heroDocumentId: string | null;
  /** UploadedDocument ids; previewed via the public /welcome/photo/[id] route. */
  gallery: string[];
  /** Whether the publicSite module is on (drives the live/draft hint). */
  enabled: boolean;
  businessName: string;
}

const TEXTAREA_CLASS = "w-full rounded-md border p-2 text-sm";
const FILE_CLASS =
  "block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm";
const ACCEPT = "image/png,image/jpeg,image/webp";
const photoUrl = (id: string) => `/welcome/photo/${id}`;

export function PublicSiteForm({ initial }: { initial: PublicSiteInitial }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePublicSiteAction,
    {},
  );
  const [heroState, heroAction, heroPending] = useActionState<FormState, FormData>(
    savePublicSiteHeroAction,
    {},
  );
  const [galleryState, galleryAction, galleryPending] = useActionState<
    FormState,
    FormData
  >(addGalleryImagesAction, {});

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Your public marketing site for {initial.businessName}. Logo, name, brand
        color, and contact details come from{" "}
        <Link href="/settings/organization" className="text-primary underline underline-offset-2">
          Organization
        </Link>
        ; privacy &amp; terms from{" "}
        <Link href="/settings/messaging" className="text-primary underline underline-offset-2">
          Messaging → Compliance
        </Link>
        .{" "}
        {initial.enabled ? (
          <span className="font-medium text-foreground">The public site is live.</span>
        ) : (
          <>
            It is <span className="font-medium text-foreground">not live yet</span> — turn on
            the “Public website” module in{" "}
            <Link href="/settings/modules" className="text-primary underline underline-offset-2">
              Modules
            </Link>
            .
          </>
        )}
      </p>

      {/* ---- Text content ---- */}
      <form action={formAction} className="space-y-6">
        {state.error && (
          <Alert variant="destructive">
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}
        {state.ok && (
          <Alert>
            <AlertDescription>Public site content saved.</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
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
              The address residents use. Tenant-portal invite &amp; reset links point here; leave
              blank to use the staff address. Set this once DNS + your reverse proxy route the
              domain to the app (see docs/PUBLIC_SITE.md).
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
        </div>

        <div className="space-y-2">
          <Label htmlFor="publicSiteIntro">Intro blurb</Label>
          <textarea
            id="publicSiteIntro"
            name="publicSiteIntro"
            rows={3}
            className={TEXTAREA_CLASS}
            placeholder="A sentence or two about your community and what makes it a great place to live."
            defaultValue={initial.publicSiteIntro}
          />
          <p className="text-xs text-muted-foreground">
            Doubles as your “About” section. For SMS carrier verification
            (10DLC), clearly state what your business does and the services you
            provide — e.g. “… a residential property-management company offering
            rentals and resident services in the Austin area.”
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="publicSiteAmenities">Amenities (one per line)</Label>
          <textarea
            id="publicSiteAmenities"
            name="publicSiteAmenities"
            rows={5}
            className={TEXTAREA_CLASS}
            placeholder={"In-unit laundry\nOff-street parking\nPet friendly\nCentral air\nUpdated kitchens"}
            defaultValue={initial.publicSiteAmenities}
          />
          <p className="text-xs text-muted-foreground">
            Shown as a checklist grid. Leave blank to hide the amenities section.
          </p>
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

        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            name="publicSiteShowAvailability"
            defaultChecked={initial.showAvailability}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            <span className="font-medium">Show current availability</span> — lists your
            currently-vacant units (beds/baths/rent/available date, no floor plans) with an Apply
            link, pulled live from your data. Leave off to keep the site marketing-only.
          </span>
        </label>

        <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
          <input
            type="checkbox"
            name="showVacancies"
            defaultChecked={initial.showVacancies}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            <span className="font-medium">Enable the vacancies page</span> — a dedicated{" "}
            <Link href="/vacancies" className="text-primary underline underline-offset-2">
              /vacancies
            </Link>{" "}
            browse page (filter by property, sort by rent/availability) linked from your public
            site. Requires the public website module. Leave off to hide it.
          </span>
        </label>

        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save content"}
        </Button>
      </form>

      {/* ---- Hero image ---- */}
      <form action={heroAction} className="space-y-3 border-t pt-6">
        <div>
          <p className="text-sm font-medium">Hero image</p>
          <p className="text-xs text-muted-foreground">
            A wide banner photo at the top of the site (PNG/JPEG/WebP, max 5 MB).
          </p>
        </div>
        {heroState.error && (
          <Alert variant="destructive">
            <AlertDescription>{heroState.error}</AlertDescription>
          </Alert>
        )}
        {heroState.ok && (
          <Alert>
            <AlertDescription>Hero image updated.</AlertDescription>
          </Alert>
        )}
        {initial.heroDocumentId && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- operator asset, not optimizable */}
            <img
              src={photoUrl(initial.heroDocumentId)}
              alt="Current hero"
              className="h-32 w-full max-w-xl rounded-md border object-cover"
            />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="removeHero" className="size-4 accent-primary" />
              Remove the current hero image
            </label>
          </>
        )}
        <input type="file" name="heroImage" accept={ACCEPT} className={FILE_CLASS} />
        <Button type="submit" variant="outline" disabled={heroPending}>
          {heroPending ? "Saving…" : "Save hero image"}
        </Button>
      </form>

      {/* ---- Photo gallery ---- */}
      <div className="space-y-3 border-t pt-6">
        <div>
          <p className="text-sm font-medium">Photo gallery</p>
          <p className="text-xs text-muted-foreground">
            Property photos shown in a grid (max 30). Add a few of your best.
          </p>
        </div>

        {initial.gallery.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {initial.gallery.map((id) => (
              <div key={id} className="space-y-1">
                {/* eslint-disable-next-line @next/next/no-img-element -- operator asset, not optimizable */}
                <img
                  src={photoUrl(id)}
                  alt="Gallery photo"
                  className="aspect-square w-full rounded-md border object-cover"
                />
                <form action={removeGalleryImageAction}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="ghost" size="xs" className="w-full">
                    Remove
                  </Button>
                </form>
              </div>
            ))}
          </div>
        )}

        <form action={galleryAction} className="space-y-3">
          {galleryState.error && (
            <Alert variant="destructive">
              <AlertDescription>{galleryState.error}</AlertDescription>
            </Alert>
          )}
          {galleryState.ok && (
            <Alert>
              <AlertDescription>Photos added.</AlertDescription>
            </Alert>
          )}
          <input
            type="file"
            name="galleryImages"
            accept={ACCEPT}
            multiple
            className={FILE_CLASS}
          />
          <Button type="submit" variant="outline" disabled={galleryPending}>
            {galleryPending ? "Uploading…" : "Add photos"}
          </Button>
        </form>
      </div>
    </div>
  );
}
