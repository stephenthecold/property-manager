import { getAppSettings } from "@/lib/services/app-settings";
import { resolveComplianceLinks } from "@/lib/config/compliance";
import { getPortalSession } from "@/lib/portal/session";
import { signOutPortalAction } from "./actions";
import { exitImpersonationAction } from "./impersonation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant-portal shell — deliberately minimal and chrome-free: business name,
 * the signed-in tenant, and a sign-out button. /portal is a staff-middleware
 * PUBLIC_PREFIX; every page under it re-checks the PORTAL session itself.
 * With the module off, the whole subtree collapses to one notice (logins are
 * refused at the service layer too).
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getAppSettings();
  if (!settings.modules.tenantPortal) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4">
        <Card className="w-full">
          <CardContent className="py-10 text-center">
            <div className="text-lg font-semibold">
              The tenant portal is currently unavailable.
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Please contact your property manager.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const identity = await getPortalSession();
  const { privacy, terms } = resolveComplianceLinks(settings);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      {identity?.impersonatedByUserId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200">
          <span>
            Impersonating {identity.tenant.firstName} {identity.tenant.lastName} —
            staff debug session.
          </span>
          <form action={exitImpersonationAction}>
            <button type="submit" className="underline underline-offset-2">
              Exit impersonation
            </button>
          </form>
        </div>
      )}
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="text-lg font-semibold">{settings.businessName}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Tenant portal
          </div>
        </div>
        {identity && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {identity.tenant.firstName} {identity.tenant.lastName}
            </span>
            <form action={signOutPortalAction}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        )}
      </header>
      {children}
      {(privacy.href || terms.href) && (
        <footer className="mt-8 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t pt-4 text-xs text-muted-foreground">
          {privacy.href && (
            <a href={privacy.href} className="underline underline-offset-2 hover:text-foreground">
              Privacy Policy
            </a>
          )}
          {terms.href && (
            <a href={terms.href} className="underline underline-offset-2 hover:text-foreground">
              Terms &amp; Conditions
            </a>
          )}
        </footer>
      )}
    </div>
  );
}
