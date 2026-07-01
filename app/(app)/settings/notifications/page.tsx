import { requireRole } from "@/lib/auth/session";
import { roleAtLeast } from "@/lib/auth/rbac";
import type { Role } from "@/lib/generated/prisma/enums";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NotificationsForm } from "./notifications-form";

export const runtime = "nodejs";

/** Self-service: every staff member manages their own notification settings. */
export default async function NotificationsSettingsPage() {
  const { dbUser } = await requireRole("viewer");
  const isStaffRecipient = roleAtLeast(dbUser.role as Role, "manager");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">My notifications</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          These settings apply to you only ({dbUser.email}). Digests and alerts
          go to manager, finance, admin, and owner accounts; admins can adjust
          anyone&apos;s settings from Settings → Users.
        </p>
        {!isStaffRecipient && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Your role (viewer) doesn&apos;t receive staff notifications — these
            toggles take effect if your role is raised.
          </p>
        )}
        <NotificationsForm
          initial={{
            phone: dbUser.phone ?? "",
            notifyOverdueDigest: dbUser.notifyOverdueDigest,
            notifyMaintenanceDigest: dbUser.notifyMaintenanceDigest,
            notifyLeaseExpiration: dbUser.notifyLeaseExpiration,
            notifyCashPickup: dbUser.notifyCashPickup,
            notifyPaymentRecorded: dbUser.notifyPaymentRecorded,
            notifyMaintenanceRequest: dbUser.notifyMaintenanceRequest,
          }}
        />
      </CardContent>
    </Card>
  );
}
