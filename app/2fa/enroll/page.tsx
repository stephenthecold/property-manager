import { redirect } from "next/navigation";
import { getSessionUser, twoFactorRedirect } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { getOrCreatePendingSecret } from "@/lib/services/totp";
import { otpauthUrl } from "@/lib/auth/totp";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { brandedPageMetadata } from "@/lib/config/metadata";
import type { Metadata } from "next";
import { ForcedEnrollForm } from "./enroll-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return brandedPageMetadata((await getAppSettings()).businessName, "Set up two-factor");
}

/**
 * Forced 2FA enrollment, reached when the org requires 2FA (require2fa) and this
 * user has not enrolled. A pending-challenge session is sent to /2fa instead; an
 * already-enrolled or non-enforced session is sent onward. Break-glass never
 * lands here (twoFactorRedirect exempts it).
 */
export default async function ForcedEnrollPage() {
  const u = await getSessionUser();
  if (!u) redirect("/login");

  // If this user actually owes the login challenge (enrolled, not enroll), or
  // nothing at all, route accordingly.
  const to = await twoFactorRedirect(u);
  if (to !== "/2fa/enroll") redirect(to ?? "/dashboard");

  const app = await getAppSettings();
  const secret = await getOrCreatePendingSecret(u.id);
  const url = otpauthUrl(secret, u.email ?? u.id, app.businessName);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <BrandColorStyle color={app.brandColor} />
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="text-2xl">Set up two-factor authentication</CardTitle>
          <CardDescription>
            Your organization requires two-factor authentication. Add this
            account to an authenticator app (Google Authenticator, Authy,
            1Password, …), then enter a code to finish. Signing in as {u.email}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForcedEnrollForm secret={secret} otpauthUrl={url} />
        </CardContent>
      </Card>
    </div>
  );
}
