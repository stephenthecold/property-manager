"use server";

import { revalidatePath } from "next/cache";
import { withAudit } from "@/lib/audit/audit";
import { auditActor, requireRole } from "@/lib/auth/session";

export interface NotificationsState {
  ok?: boolean;
  error?: string;
  message?: string;
}

/** Loose sanity check, not strict E.164 — operators enter staff cells by hand. */
function normalizePhone(raw: string): string | null | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\+?[0-9() .-]{7,20}$/.test(trimmed)) {
    return { error: "That phone number doesn't look valid." };
  }
  return trimmed;
}

/** Self-service: every active staff member may edit their OWN notifications. */
export async function saveMyNotificationsAction(
  _prev: NotificationsState,
  fd: FormData,
): Promise<NotificationsState> {
  const { dbUser } = await requireRole("viewer");
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (phone !== null && typeof phone === "object") return phone;

  const data = {
    phone,
    notifyOverdueDigest: fd.get("notifyOverdueDigest") === "on",
    notifyMaintenanceDigest: fd.get("notifyMaintenanceDigest") === "on",
    notifyLeaseExpiration: fd.get("notifyLeaseExpiration") === "on",
    notifyCashPickup: fd.get("notifyCashPickup") === "on",
  };
  await withAudit(
    {
      ...(await auditActor()),
      action: "user.notifications.updated",
      entityType: "User",
      entityId: dbUser.id,
      before: {
        phone: dbUser.phone,
        notifyOverdueDigest: dbUser.notifyOverdueDigest,
        notifyMaintenanceDigest: dbUser.notifyMaintenanceDigest,
        notifyLeaseExpiration: dbUser.notifyLeaseExpiration,
        notifyCashPickup: dbUser.notifyCashPickup,
      },
    },
    async (tx) => {
      await tx.user.update({ where: { id: dbUser.id }, data });
      return { result: undefined, after: data };
    },
  );
  revalidatePath("/settings/notifications");
  return { ok: true, message: "Notification settings saved." };
}
