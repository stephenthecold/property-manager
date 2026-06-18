import Link from "next/link";
import { getDisplayRole } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/settings";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability, type Capability } from "@/lib/auth/permissions";
import { doSignOut } from "@/app/login/actions";
import { exitViewAs } from "@/app/(app)/settings/users/actions";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { NavLinks, type NavEntry } from "@/components/app/nav-links";
import { BrandColorStyle } from "@/components/app/brand-color-style";
import { TablePageSizeProvider } from "@/components/app/data-table";
import { brandedLayoutMetadata } from "@/lib/config/metadata";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { CommandPalette } from "@/components/app/command-palette";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const runtime = "nodejs";

export async function generateMetadata(): Promise<Metadata> {
  return brandedLayoutMetadata((await getAppSettings()).businessName);
}

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
  // Links are grouped into a few dropdowns to keep the header from overflowing;
  // a group with no visible children is dropped entirely.
  const can = (cap: Capability) => hasCapability(actingRole, cap, app.rolePermissions);
  const navEntries: NavEntry[] = (
    [
      { href: "/dashboard", label: "Dashboard" },
      {
        label: "Leasing",
        items: [
          { href: "/properties", label: "Properties" },
          { href: "/tenants", label: "Tenants" },
          { href: "/leases", label: "Leases" },
          ...(app.modules.applications && can("applications.view")
            ? [{ href: "/applications", label: "Applications" }]
            : []),
          ...(can("documents.manage") ? [{ href: "/documents", label: "Documents" }] : []),
        ],
      },
      {
        label: "Money",
        items: [
          { href: "/payments", label: "Payments" },
          ...(can("payers.manage") ? [{ href: "/payers", label: "Payers" }] : []),
          ...(app.modules.financials && can("financials.view")
            ? [{ href: "/financials", label: "Financials" }]
            : []),
          ...(can("reports.view") ? [{ href: "/reports", label: "Reports" }] : []),
        ],
      },
      {
        label: "Operations",
        items: [
          ...(app.modules.maintenance && can("maintenance.manage")
            ? [{ href: "/maintenance", label: "Maintenance" }]
            : []),
          ...(app.modules.inspections && can("inspections.manage")
            ? [{ href: "/inspections", label: "Inspections" }]
            : []),
          ...(app.modules.vendors && can("vendors.manage")
            ? [{ href: "/vendors", label: "Vendors" }]
            : []),
          ...(app.modules.tenantPortal && can("portal.manage")
            ? [{ href: "/requests", label: "Requests" }]
            : []),
        ],
      },
      {
        label: "Comms",
        items: [
          { href: "/reminders", label: "Reminders" },
          ...(can("tenants.manage") ? [{ href: "/sms-consents", label: "SMS consent" }] : []),
          ...(app.modules.notices && can("notices.manage")
            ? [{ href: "/notices", label: "Notices" }]
            : []),
        ],
      },
    ] satisfies NavEntry[]
  ).filter((e) => !("items" in e) || (e.items?.length ?? 0) > 0);
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
      <BrandColorStyle color={app.brandColor} />
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
            <NavLinks items={navEntries} />
          </div>
          <div className="flex items-center gap-3 text-sm">
            {/* ⌘K palette searches operating records; gate on the acting role's
                tenants.manage (the cap /api/search requires) like every nav link
                above, so it only shows to users who can actually use it. */}
            {can("tenants.manage") && <CommandPalette />}
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
        <TablePageSizeProvider value={app.defaultTablePageSize ?? 10}>
          {children}
        </TablePageSizeProvider>
      </main>
    </div>
  );
}
