import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAppSettings } from "@/lib/services/app-settings";
import { getEnv } from "@/lib/config/env";
import { brandedPageMetadata } from "@/lib/config/metadata";
import {
  availabilityWhen,
  formatBedsBaths,
  formatRent,
  listPublicAvailability,
} from "@/lib/services/public-site";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { Button } from "@/components/ui/button";
import { VacanciesBrowser, type VacancyCard } from "./vacancies-browser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return brandedPageMetadata((await getAppSettings()).businessName, "Vacancies");
}

/**
 * Public vacancies browse page served at the public host (`/vacancies`). NO
 * session — a PUBLIC_PREFIX like /welcome. Gated TWICE: the publicSite module
 * must be on AND Settings → Public site must enable the vacancies page; when
 * either is off, send visitors to the marketing splash. Lists only marketing
 * fields of VACANT / upcoming-vacant units (lib/services/public-site.ts) — no
 * tenant data, no occupied/off-market units.
 */
export default async function VacanciesPage() {
  const s = await getAppSettings();
  if (!s.modules.publicSite || !s.showVacancies) redirect("/welcome");

  const rows = await listPublicAvailability(new Date());
  const units: VacancyCard[] = rows.map((u) => ({
    unitId: u.unitId,
    propertyName: u.propertyName,
    bedsBaths: formatBedsBaths(u.bedrooms, u.bathrooms),
    rentCents: String(u.rentCents),
    rentLabel: formatRent(u.rentCents),
    whenLabel: availabilityWhen(u.availableNow, u.availableOn),
    // Ascending availability key: available-now sorts first (0), then soonest date.
    availSort: u.availableNow ? 0 : (u.availableOn?.getTime() ?? Number.MAX_SAFE_INTEGER),
    applyHref: s.modules.applications ? `/apply?unit=${u.unitId}` : null,
  }));

  const staffUrl = getEnv().APP_URL.replace(/\/+$/, "");

  return (
    <div className="min-h-screen bg-background">
      <BrandColorStyle color={s.brandColor} />

      {/* Header */}
      <section className="border-b">
        <div className="mx-auto max-w-5xl px-4 py-12 text-center">
          <div className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {s.businessName}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
            Available rentals
          </h1>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Browse our current and upcoming vacancies. Found a place you like?
            {s.modules.applications ? " Apply online in minutes." : " Get in touch to apply."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button variant="secondary" render={<Link href="/welcome" />}>
              Back to home
            </Button>
            {s.modules.applications && (
              <Button render={<Link href="/apply" />}>Apply now</Button>
            )}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-5xl px-4 py-12">
        {units.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-card-foreground">
            <p className="text-lg font-medium">No units are available right now</p>
            <p className="mt-2 text-muted-foreground">
              Check back soon
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
          </div>
        ) : (
          <VacanciesBrowser units={units} />
        )}
      </main>

      {/* Footer (mirrors /welcome) */}
      <footer className="border-t">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-8 text-xs text-muted-foreground">
          <Link href="/welcome" className="hover:text-foreground hover:underline">
            Home
          </Link>
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
