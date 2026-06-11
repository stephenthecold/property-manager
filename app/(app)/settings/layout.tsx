import { requireRole, getDisplayRole } from "@/lib/auth/session";
import { roleAtLeast } from "@/lib/auth/rbac";
import { SettingsNav } from "@/components/app/settings-nav";

export const runtime = "nodejs";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // finance+ may enter (for Billing); each page enforces its own stricter gate.
  await requireRole("finance");
  const { actingRole } = await getDisplayRole();
  const isAdmin = roleAtLeast(actingRole, "admin");

  const links = [
    { href: "/settings/billing", label: "Billing" },
    ...(isAdmin
      ? [
          { href: "/settings/organization", label: "Organization" },
          { href: "/settings/messaging", label: "Messaging" },
          { href: "/settings/auth", label: "Authentication" },
          { href: "/settings/users", label: "Users" },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="border-b pb-3">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Billing rates are editable by finance and above; everything else is
          admin-only. Every change is audited.
        </p>
      </div>
      <SettingsNav links={links} />
      {children}
    </div>
  );
}
