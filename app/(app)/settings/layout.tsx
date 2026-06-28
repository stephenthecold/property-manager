import { redirect } from "next/navigation";
import { getDisplayRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability, type Capability } from "@/lib/auth/permissions";
import { SettingsNav, type SettingsNavGroup } from "@/components/app/settings-nav";
import { PageHeader } from "@/components/app/page-header";

export const runtime = "nodejs";

// Settings sections grouped into logical sub-menus. cap: null = self-service
// section, visible to every signed-in staff member. module: gate the link on an
// optional feature module being enabled.
type SettingsLink = {
  href: string;
  label: string;
  cap: Capability | null;
  module?: "tenantPortal" | "applications" | "inspections";
};

const SETTINGS_GROUPS: { label: string; links: SettingsLink[] }[] = [
  {
    label: "Organization",
    links: [
      { href: "/settings/organization", label: "Organization", cap: "organization.settings" },
      { href: "/settings/public-site", label: "Public site", cap: "organization.settings" },
    ],
  },
  {
    label: "Leasing",
    links: [
      { href: "/settings/billing", label: "Billing", cap: "billing.settings" },
      { href: "/settings/leases", label: "Leases", cap: "organization.settings" },
      {
        href: "/settings/applications",
        label: "Applications",
        cap: "applications.manage",
        module: "applications",
      },
      {
        href: "/settings/inspection-templates",
        label: "Inspection templates",
        cap: "inspections.manage",
        module: "inspections",
      },
    ],
  },
  {
    label: "Communications",
    links: [
      { href: "/settings/notifications", label: "Notifications", cap: null },
      { href: "/settings/messaging", label: "Messaging", cap: "messaging.settings" },
      { href: "/settings/inbox", label: "Email inbox", cap: "messaging.settings" },
      { href: "/settings/report-schedules", label: "Scheduled reports", cap: "reports.schedule" },
    ],
  },
  {
    label: "Access",
    links: [
      // Self-service: every staff member manages their OWN 2FA here (the
      // owner-only org-enforcement toggle is rendered inside the page).
      { href: "/settings/security", label: "Security (2FA)", cap: null },
      { href: "/settings/auth", label: "Authentication", cap: "auth.settings" },
      { href: "/settings/users", label: "Users", cap: "users.manage" },
      { href: "/settings/permissions", label: "Permissions", cap: "users.manage" },
    ],
  },
  {
    label: "Platform",
    links: [
      { href: "/settings/modules", label: "Modules", cap: "organization.settings" },
      {
        href: "/settings/impersonate",
        label: "Impersonate",
        cap: "portal.impersonate",
        module: "tenantPortal",
      },
    ],
  },
];

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { actingRole } = await getDisplayRole();
  const { rolePermissions, modules } = await getAppSettings();

  // Keep only sections this role can edit (and whose module is on); drop any
  // group left empty. Each page re-checks its own gate.
  const groups: SettingsNavGroup[] = SETTINGS_GROUPS.map((g) => ({
    label: g.label,
    links: g.links
      .filter(
        (l) =>
          (!l.module || modules[l.module]) &&
          (l.cap === null || hasCapability(actingRole, l.cap, rolePermissions)),
      )
      .map((l) => ({ href: l.href, label: l.label })),
  })).filter((g) => g.links.length > 0);

  if (groups.length === 0) redirect("/dashboard");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="You see only the sections your role can edit. Every change is audited."
      />
      <div className="md:grid md:grid-cols-[200px_minmax(0,1fr)] md:gap-8 lg:gap-10">
        <aside className="mb-6 border-b pb-6 md:mb-0 md:border-b-0 md:pb-0">
          <SettingsNav groups={groups} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
