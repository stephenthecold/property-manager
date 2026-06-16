import Link from "next/link";
import { getDisplayRole } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/settings";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability, type Capability } from "@/lib/auth/permissions";
import { doSignOut } from "@/app/login/actions";
import { exitViewAs } from "@/app/(app)/settings/users/actions";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { NavLinks, type NavItem } from "@/components/app/nav-links";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const runtime = "nodejs";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, actingRole, viewAs } = await getDisplayRole();
  const [settings, app] = await Promise.all([
    getAuthSettings(),
    getAppSettings(),
  ]);

  // Nav reflects the acting role's capabilities (so links never lead to a
  // "Forbidden" page). Viewing surfaces stay visible; capability-gated ones hide.
  const can = (cap: Capability) => hasCapability(actingRole, cap, app.rolePermissions);
  const navItems: NavItem[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/properties", label: "Properties" },
    { href: "/tenants", label: "Tenants" },
    { href: "/leases", label: "Leases" },
    { href: "/payments", label: "Payments" },
    ...(can("documents.manage") ? [{ href: "/documents", label: "Documents" }] : []),
    { href: "/reminders", label: "Reminders" },
    ...(can("tenants.manage") ? [{ href: "/sms-consents", label: "SMS consent" }] : []),
    ...(can("reports.view") ? [{ href: "/reports", label: "Reports" }] : []),
    ...(app.modules.financials && can("financials.view")
      ? [{ href: "/financials", label: "Financials" }]
      : []),
    ...(app.modules.maintenance && can("maintenance.manage")
      ? [{ href: "/maintenance", label: "Maintenance" }]
      : []),
    ...(app.modules.tenantPortal && can("portal.manage")
      ? [{ href: "/requests", label: "Requests" }]
      : []),
    ...(app.modules.applications && can("applications.view")
      ? [{ href: "/applications", label: "Applications" }]
      : []),
  ];
  const showSettings = (
    ["billing.settings", "organization.settings", "messaging.settings", "auth.settings", "users.manage"] as Capability[]
  ).some(can);

  // Business logo (uploaded at Settings → Organization) for the banner.
  let logoUrl: string | null = null;
  if (app.logoDocumentId) {
    try {
      logoUrl = (await getDocumentDownloadUrl(app.logoDocumentId))?.url ?? null;
    } catch {
      logoUrl = null; // storage not configured — banner falls back to text only
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="print-hidden border-b bg-card">
        <div className="mx-auto flex w-full max-w-[100rem] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 xl:px-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-semibold whitespace-nowrap"
            >
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; next/image can't optimize it
                <img
                  src={logoUrl}
                  alt=""
                  className="h-7 w-auto max-w-28 rounded object-contain"
                />
              )}
              {app.businessName}
            </Link>
            <NavLinks items={navItems} />
          </div>
          <div className="flex items-center gap-3 text-sm">
            {can("audit.view") && (
              <Link href="/audit" className="text-muted-foreground hover:underline">
                Audit
              </Link>
            )}
            {showSettings && (
              <Link href="/settings" className="text-muted-foreground hover:underline">
                Settings
              </Link>
            )}
            <span className="text-muted-foreground">
              {user.email} · {actingRole}
            </span>
            <ThemeToggle />
            <form action={doSignOut}>
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
        {user.viaBreakGlass && (
          <div className="bg-red-600 px-4 py-1.5 text-center text-sm font-medium text-white">
            Break-glass session — get SSO sign-in working, then disable break-glass.
          </div>
        )}
        {viewAs && (
          <div className="flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-sm font-medium text-black">
            <span>
              Viewing as <span className="capitalize">{viewAs}</span> — your real
              role is <span className="capitalize">{user.role}</span>.
            </span>
            <form action={exitViewAs}>
              <button type="submit" className="underline underline-offset-2">
                Exit
              </button>
            </form>
          </div>
        )}
      </header>

      {settings.breakGlassEnabled && !user.viaBreakGlass && (
        <div className="print-hidden mx-auto mt-4 w-full max-w-[100rem] px-4 sm:px-6 xl:px-8">
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

      <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-6 sm:px-6 xl:px-8">
        {children}
      </main>
    </div>
  );
}
