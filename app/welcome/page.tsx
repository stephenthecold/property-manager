import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAppSettings } from "@/lib/services/app-settings";
import { getEnv } from "@/lib/config/env";
import { brandedPageMetadata } from "@/lib/config/metadata";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return brandedPageMetadata((await getAppSettings()).businessName);
}

/**
 * Public marketing splash served at the public host root (Caddy rewrites
 * `/` → `/welcome`). NO session — "/welcome" is a PUBLIC_PREFIX. Module-gated:
 * when the publicSite module is off, send visitors to the resident login so the
 * public hostname still does something useful before the splash is turned on.
 * Operator-authored copy + branding come from Settings; nothing here reads
 * tenant data.
 */
export default async function WelcomePage() {
  const s = await getAppSettings();
  if (!s.modules.publicSite) redirect("/portal");

  // Staff console lives on the canonical app host (e.g. manage.newedgerentals.com).
  const staffUrl = getEnv().APP_URL.replace(/\/+$/, "");
  const contact = [s.businessPhone, s.businessEmail].filter(Boolean).join(" · ");

  return (
    <div className="min-h-screen">
      <BrandColorStyle color={s.brandColor} />
      <main className="mx-auto max-w-3xl space-y-10 px-4 py-16">
        {/* Hero */}
        <section className="space-y-4 text-center">
          <div className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            {s.businessName}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {s.publicSiteTagline?.trim() || `Welcome to ${s.businessName}`}
          </h1>
          {s.publicSiteIntro?.trim() && (
            <p className="mx-auto max-w-2xl whitespace-pre-wrap text-base text-muted-foreground">
              {s.publicSiteIntro}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {s.modules.applications && (
              <Button size="lg" render={<Link href="/apply" />}>
                Apply now
              </Button>
            )}
            {s.modules.tenantPortal && (
              <Button size="lg" variant="outline" render={<Link href="/portal" />}>
                Resident login
              </Button>
            )}
            {s.modules.payerPortal && (
              <Button size="lg" variant="outline" render={<Link href="/payer-portal" />}>
                Payer login
              </Button>
            )}
          </div>
        </section>

        {/* Areas served + office hours */}
        {(s.publicSiteAreas?.trim() || s.publicSiteHours?.trim()) && (
          <section className="grid gap-4 sm:grid-cols-2">
            {s.publicSiteAreas?.trim() && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Areas we serve</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {s.publicSiteAreas}
                  </p>
                </CardContent>
              </Card>
            )}
            {s.publicSiteHours?.trim() && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Office hours</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {s.publicSiteHours}
                  </p>
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* Contact */}
        {(contact || s.businessAddress?.trim()) && (
          <section className="space-y-1 text-center text-sm text-muted-foreground">
            <div className="font-medium text-foreground">Contact us</div>
            {contact && <div>{contact}</div>}
            {s.businessAddress?.trim() && (
              <div className="whitespace-pre-wrap">{s.businessAddress}</div>
            )}
          </section>
        )}

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t pt-6 text-xs text-muted-foreground">
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
        </footer>
      </main>
    </div>
  );
}
