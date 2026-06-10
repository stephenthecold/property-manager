import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/settings";
import { roleAtLeast } from "@/lib/auth/rbac";
import { doSignOut } from "@/app/login/actions";
import { NavLinks } from "@/components/app/nav-links";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const runtime = "nodejs";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const settings = await getAuthSettings();
  const isOwner = roleAtLeast(user.role, "owner");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="font-semibold">
              Property Manager
            </Link>
            <NavLinks />
          </div>
          <div className="flex items-center gap-3 text-sm">
            {isOwner && (
              <Link href="/settings/auth" className="text-muted-foreground hover:underline">
                Settings
              </Link>
            )}
            <span className="text-muted-foreground">
              {user.email} · {user.role}
            </span>
            <form action={doSignOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        {user.viaBreakGlass && (
          <div className="bg-red-600 px-4 py-1.5 text-center text-sm font-medium text-white">
            Break-glass session — auth settings are locked. Restore SSO and disable break-glass.
          </div>
        )}
      </header>

      {settings.breakGlassEnabled && !user.viaBreakGlass && (
        <div className="mx-auto mt-4 w-full max-w-6xl px-4">
          <Alert variant="destructive">
            <AlertTitle>Break-glass is enabled</AlertTitle>
            <AlertDescription>
              Emergency local login is active. Disable it under{" "}
              <Link href="/settings/auth" className="underline">
                Settings → Authentication
              </Link>{" "}
              once SSO is verified.
            </AlertDescription>
          </Alert>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
