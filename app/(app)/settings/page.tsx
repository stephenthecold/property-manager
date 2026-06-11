import { redirect } from "next/navigation";
import { getDisplayRole } from "@/lib/auth/session";
import { roleAtLeast } from "@/lib/auth/rbac";

export const runtime = "nodejs";

export default async function SettingsIndexPage() {
  const { actingRole } = await getDisplayRole();
  redirect(
    roleAtLeast(actingRole, "admin") ? "/settings/organization" : "/settings/billing",
  );
}
