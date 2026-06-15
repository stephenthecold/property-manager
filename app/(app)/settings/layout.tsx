import { redirect } from "next/navigation";
import { getDisplayRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability, type Capability } from "@/lib/auth/permissions";
import { SettingsNav } from "@/components/app/settings-nav";

export const runtime = "nodejs";

// cap: null = self-service section, visible to every signed-in staff member.
// module: gate the link on an optional feature module being enabled.
const SETTINGS_LINKS: {
  href: string;
  label: string;
  cap: Capability | null;
  module?: "tenantPortal" | "applications";
}[] = [
  { href: "/settings/notifications", label: "Notifications", cap: null },
  { href: "/settings/billing", label: "Billing", cap: "billing.settings" },
  { href: "/settings/organization", label: "Organization", cap: "organization.settings" },
  { href: "/settings/leases", label: "Leases", cap: "organization.settings" },
  { href: "/settings/messaging", label: "Messaging", cap: "messaging.settings" },
  {
    href: "/settings/applications",
    label: "Applications",
    cap: "applications.manage",
    module: "applications",
  },
  { href: "/settings/auth", label: "Authentication", cap: "auth.settings" },
  { href: "/settings/users", label: "Users", cap: "users.manage" },
  { href: "/settings/permissions", label: "Permissions", cap: "users.manage" },
  { href: "/settings/modules", label: "Modules", cap: "organization.settings" },
  {
    href: "/settings/impersonate",
    label: "Impersonate",
    cap: "portal.impersonate",
    module: "tenantPortal",
  },
];

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { actingRole } = await getDisplayRole();
  const { rolePermissions, modules } = await getAppSettings();

  // Show only the sections this role can edit (and whose module is on); each
  // page re-checks its own gate.
  const links = SETTINGS_LINKS.filter(
    (l) =>
      (!l.module || modules[l.module]) &&
      (l.cap === null || hasCapability(actingRole, l.cap, rolePermissions)),
  );
  if (links.length === 0) redirect("/dashboard");

  return (
    <div className="space-y-4">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          You see only the sections your role can edit. Every change is audited.
        </p>
      </div>
      <SettingsNav links={links} />
      {children}
    </div>
  );
}
