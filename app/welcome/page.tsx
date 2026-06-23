import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { CheckIcon } from "lucide-react";
import { getAppSettings } from "@/lib/services/app-settings";
import { getEnv } from "@/lib/config/env";
import { brandedPageMetadata } from "@/lib/config/metadata";
import {
  availabilityWhen,
  formatBedsBaths,
  listPublicAvailability,
} from "@/lib/services/public-site";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return brandedPageMetadata((await getAppSettings()).businessName);
}

const photoUrl = (id: string) => `/welcome/photo/${id}`;

/** Display-only money format from integer cents — BigInt math, never a float. */
function formatRent(cents: bigint): string {
  const dollars = (cents / 100n).toLocaleString("en-US");
  const rem = Number(cents % 100n);
  return rem === 0 ? `$${dollars}` : `$${dollars}.${String(rem).padStart(2, "0")}`;
}

/**
 * Public marketing site served at the public host root (Caddy rewrites
 * `/` → `/welcome`). NO session — "/welcome" is a PUBLIC_PREFIX. Module-gated:
 * when the publicSite module is off, send visitors to the resident login.
 * Operator-authored copy/photos + branding come from Settings. The only
 * tenant-adjacent data is the opt-in current-availability list, which exposes
 * marketing fields of VACANT units only (lib/services/public-site.ts).
 */
export default async function WelcomePage() {
  const s = await getAppSettings();
  if (!s.modules.publicSite) redirect("/portal");

  const staffUrl = getEnv().APP_URL.replace(/\/+$/, "");
  const tagline = s.publicSiteTagline?.trim();
  const intro = s.publicSiteIntro?.trim();
  const amenities = (s.publicSiteAmenities ?? "")
    .split("\n")
    .map((a) => a.trim())
    .filter(Boolean);
  const areas = s.publicSiteAreas?.trim();
  const hours = s.publicSiteHours?.trim();
  const address = s.businessAddress?.trim();
  const phone = s.businessPhone?.trim();
  const email = s.businessEmail?.trim();
  const hero = s.publicSiteHeroDocumentId;
  const gallery = s.publicSiteGallery;
  const availability = s.publicSiteShowAvailability
    ? await listPublicAvailability(new Date())
    : [];

  return (
    <div className="min-h-screen bg-background">
      <BrandColorStyle color={s.brandColor} />

      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        {hero ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- operator asset, not optimizable */}
            <img
              src={photoUrl(hero)}
              alt=""
              className="absolute inset-0 -z-10 size-full object-cover"
            />
            <div className="absolute inset-0 -z-10 bg-black/55" />
          </>
        ) : (
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/20 via-background to-background" />
        )}
        <div className="mx-auto max-w-4xl px-4 py-24 text-center sm:py-32">
          <div className={cn(hero && "text-white")}>
            <div
              className={cn(
                "text-sm font-medium uppercase tracking-widest",
                hero ? "text-white/80" : "text-muted-foreground",
              )}
            >
              {s.businessName}
            </div>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
              {tagline || `Welcome to ${s.businessName}`}
            </h1>
            {/* With a hero image the intro reads better below the banner (the
                "Welcome" section); without one, show it here in the hero. */}
            {intro && !hero && (
              <p className="mx-auto mt-5 max-w-2xl whitespace-pre-wrap text-lg text-muted-foreground">
                {intro}
              </p>
            )}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {s.modules.applications && (
                <Button size="lg" render={<Link href="/apply" />}>
                  Apply now
                </Button>
              )}
              {s.modules.tenantPortal && (
                <Button size="lg" variant="secondary" render={<Link href="/portal" />}>
                  Resident login
                </Button>
              )}
              {s.modules.payerPortal && (
                <Button size="lg" variant="secondary" render={<Link href="/payer-portal" />}>
                  Payer login
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl space-y-16 px-4 py-16">
        {/* About / welcome (only when there's a hero, so the intro still shows
            below the fold; without a hero the intro already appears in the hero) */}
        {intro && hero && (
          <section className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight">Welcome</h2>
            <p className="mt-3 whitespace-pre-wrap text-muted-foreground">{intro}</p>
          </section>
        )}

        {/* Amenities */}
        {amenities.length > 0 && (
          <section>
            <h2 className="text-center text-2xl font-semibold tracking-tight">Amenities</h2>
            <ul className="mx-auto mt-6 grid max-w-3xl gap-3 sm:grid-cols-2">
              {amenities.map((a, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Photo gallery */}
        {gallery.length > 0 && (
          <section>
            <h2 className="text-center text-2xl font-semibold tracking-tight">Gallery</h2>
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {gallery.map((g) => (
                // eslint-disable-next-line @next/next/no-img-element -- operator asset, not optimizable
                <img
                  key={g.id}
                  src={photoUrl(g.id)}
                  alt=""
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-lg border object-cover"
                />
              ))}
            </div>
          </section>
        )}

        {/* Current availability */}
        {s.publicSiteShowAvailability && (
          <section>
            <h2 className="text-center text-2xl font-semibold tracking-tight">
              Current availability
            </h2>
            {availability.length === 0 ? (
              <p className="mt-4 text-center text-muted-foreground">
                No units are available right now — check back soon
                {s.modules.applications ? (
                  <>
                    {" "}
                    or{" "}
                    <Link href="/apply" className="text-primary underline underline-offset-2">
                      submit an application
                    </Link>
                  </>
                ) : null}
                .
              </p>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {availability.map((u) => (
                  <div
                    key={u.unitId}
                    className="flex flex-col rounded-lg border bg-card p-4 text-card-foreground"
                  >
                    <div className="font-medium">{u.propertyName}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {formatBedsBaths(u.bedrooms, u.bathrooms)}
                    </div>
                    <div className="mt-2 text-lg font-semibold">
                      {formatRent(u.rentCents)}
                      <span className="text-sm font-normal text-muted-foreground">/mo</span>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {availabilityWhen(u.availableNow, u.availableOn)}
                    </div>
                    {s.modules.applications && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3"
                        render={<Link href={`/apply?unit=${u.unitId}`} />}
                      >
                        Apply
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Location / areas + office hours */}
        {(areas || hours) && (
          <section className="grid gap-6 sm:grid-cols-2">
            {areas && (
              <div className="rounded-lg border bg-card p-5 text-card-foreground">
                <h2 className="text-lg font-semibold">Where we are</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{areas}</p>
              </div>
            )}
            {hours && (
              <div className="rounded-lg border bg-card p-5 text-card-foreground">
                <h2 className="text-lg font-semibold">Office hours</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{hours}</p>
              </div>
            )}
          </section>
        )}

        {/* Contact — labeled, clickable details so carriers (10DLC brand
            verification) and visitors can confirm how to reach the business. */}
        {(phone || email || address) && (
          <section className="text-center">
            <h2 className="text-2xl font-semibold tracking-tight">Get in touch</h2>
            <div className="mt-3 space-y-1 text-muted-foreground">
              {phone && (
                <p>
                  Call{" "}
                  <a
                    href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                    className="text-primary underline underline-offset-2"
                  >
                    {phone}
                  </a>
                </p>
              )}
              {email && (
                <p>
                  Email{" "}
                  <a
                    href={`mailto:${email}`}
                    className="text-primary underline underline-offset-2"
                  >
                    {email}
                  </a>
                </p>
              )}
              {address && <p className="whitespace-pre-wrap text-sm">{address}</p>}
            </div>
            {s.modules.applications && (
              <div className="mt-5">
                <Button render={<Link href="/apply" />}>Apply now</Button>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-8 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground hover:underline">
            Privacy policy
          </Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">
            Terms
          </Link>
          <a href={staffUrl} className="hover:text-foreground hover:underline">
            Staff login
          </a>
          <span>
            © {new Date().getFullYear()} {s.businessName}
          </span>
        </div>
      </footer>
    </div>
  );
}
