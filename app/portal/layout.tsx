import { getAppSettings } from "@/lib/services/app-settings";
import { getPortalSession } from "@/lib/portal/session";
import { signOutPortalAction } from "./actions";
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

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
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
    </div>
  );
}
