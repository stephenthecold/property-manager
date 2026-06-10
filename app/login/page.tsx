import Link from "next/link";
import { getAuthSettings } from "@/lib/auth/settings";
import { getAppSettings } from "@/lib/services/app-settings";
import { needsSetup } from "@/lib/auth/setup";
import { signInWithAuthentik } from "./actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const [settings, setup, app] = await Promise.all([
    getAuthSettings(),
    needsSetup(),
    getAppSettings(),
  ]);

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{app.businessName}</CardTitle>
          <CardDescription>Sign in to continue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {setup && (
            <Alert>
              <AlertTitle>First-time setup required</AlertTitle>
              <AlertDescription>
                No users exist yet. Open <code>/setup</code> with the bootstrap
                token printed by the installer to create the first owner.
              </AlertDescription>
            </Alert>
          )}

          {settings.oidcEnabled ? (
            <form action={signInWithAuthentik}>
              <Button type="submit" className="w-full">
                Sign in with Authentik
              </Button>
            </form>
          ) : (
            <Alert>
              <AlertTitle>Single sign-on not configured</AlertTitle>
              <AlertDescription>
                OIDC is not set up yet. Use emergency access to get in, then
                configure it under Settings → Authentication.
              </AlertDescription>
            </Alert>
          )}

          <div className="text-sm text-muted-foreground">
            {settings.breakGlassEnabled ? (
              <Link href="/emergency" className="underline">
                Use emergency access
              </Link>
            ) : (
              <span>Emergency access is disabled.</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
