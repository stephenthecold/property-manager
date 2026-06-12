import { redirect } from "next/navigation";
import { getDisplayRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability, type Capability } from "@/lib/auth/permissions";

export const runtime = "nodejs";

const ORDER: { href: string; cap: Capability }[] = [
  { href: "/settings/billing", cap: "billing.settings" },
  { href: "/settings/organization", cap: "organization.settings" },
  { href: "/settings/messaging", cap: "messaging.settings" },
  { href: "/settings/auth", cap: "auth.settings" },
  { href: "/settings/users", cap: "users.manage" },
];

export default async function SettingsIndexPage() {
  const { actingRole } = await getDisplayRole();
  const { rolePermissions } = await getAppSettings();
  const first = ORDER.find((s) => hasCapability(actingRole, s.cap, rolePermissions));
  redirect(first?.href ?? "/dashboard");
}
