import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsImpersonatePanel } from "./impersonate-panel";

export const runtime = "nodejs";

/**
 * Settings → Impersonate: a central place to open the tenant portal AS any
 * tenant for debugging/smoke testing. Gated by portal.impersonate (admin
 * default) and the tenantPortal module; mirrors the per-tenant card.
 */
export default async function ImpersonateSettingsPage() {
  await requireCapability("portal.impersonate");
  const { modules } = await getAppSettings();
  if (!modules.tenantPortal) redirect("/settings");

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: { id: true, firstName: true, lastName: true },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Impersonate a tenant</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Open the tenant portal as a tenant to debug and smoke-test their
          experience. Every impersonation is audited and shows a banner, and
          sessions are short-lived. You can also do this from any tenant&apos;s
          page.
        </p>
        <SettingsImpersonatePanel
          tenants={tenants.map((t) => ({
            id: t.id,
            name: `${t.firstName} ${t.lastName}`,
          }))}
        />
      </CardContent>
    </Card>
  );
}
