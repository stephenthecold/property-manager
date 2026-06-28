import { redirect } from "next/navigation";
import { getSessionUser, twoFactorRedirect } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { brandedPageMetadata } from "@/lib/config/metadata";
import type { Metadata } from "next";
import { TwoFactorChallengeForm } from "./challenge-form";
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
  return brandedPageMetadata((await getAppSettings()).businessName, "Two-factor authentication");
}

/**
 * Login-time 2FA challenge. Reached while the session is twoFactorPending (the
 * user is enrolled but hasn't proven a code this login). A fully-cleared session
 * is bounced onward; a forced-enrollment session goes to /2fa/enroll; a truly
 * anonymous visitor goes to /login.
 */
export default async function TwoFactorPage() {
  const u = await getSessionUser();
  if (!u) redirect("/login");

  // Not pending: either fully authed (-> app) or owes forced enrollment.
  if (!u.twoFactorPending) {
    const to = await twoFactorRedirect(u); // "/2fa/enroll" or null
    redirect(to && to !== "/2fa" ? to : "/dashboard");
  }

  const app = await getAppSettings();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <BrandColorStyle color={app.brandColor} />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Two-factor authentication</CardTitle>
          <CardDescription>
            Enter the 6-digit code from your authenticator app to finish signing
            in as {u.email}. You can also use one of your backup codes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorChallengeForm />
        </CardContent>
      </Card>
    </div>
  );
}
