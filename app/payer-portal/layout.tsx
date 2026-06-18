import { getAppSettings } from "@/lib/services/app-settings";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { getPayerSession } from "@/lib/payer-portal/session";
import { signOutPayerAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Payer-portal shell — deliberately minimal: business name, the signed-in payer,
 * and a sign-out button. /payer-portal is a staff-middleware PUBLIC_PREFIX;
 * every page under it re-checks the PAYER session itself.
 */
export default async function PayerPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getAppSettings();
  if (!settings.modules.payerPortal) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-md items-center px-4">
        <Card className="w-full">
          <CardContent className="py-10 text-center">
            <div className="text-lg font-semibold">
              The payer portal is currently unavailable.
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Please contact the property manager.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }
  const identity = await getPayerSession();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <BrandColorStyle color={settings.brandColor} />
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div>
          <div className="text-lg font-semibold">{settings.businessName}</div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Payer portal
          </div>
        </div>
        {identity && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{identity.payer.name}</span>
            <form action={signOutPayerAction}>
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
