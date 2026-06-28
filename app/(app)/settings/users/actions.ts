"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { requireCapability, auditActor } from "@/lib/auth/session";
import { withAudit, writeAudit } from "@/lib/audit/audit";
import { adminResetTotp } from "@/lib/services/totp";
import { isRole, roleAtLeast } from "@/lib/auth/rbac";
import { VIEW_AS_COOKIE } from "@/lib/auth/view-as";
import { getFormString as str } from "@/lib/forms";
import type { Role } from "@/lib/generated/prisma/enums";

/**
 * Guard failures land back on the users page as a banner instead of being
 * thrown — a thrown server-action error renders as the opaque production
 * digest page. (These remain reachable via stale pages, e.g. acting on a
 * user whose role changed after this page loaded.)
 */
function fail(message: string): never {
  redirect(`/settings/users?error=${encodeURIComponent(message)}`);
}

/**
 * Change a user's role. Bumps securityStamp so their outstanding JWT is
 * invalidated and the new role takes effect on next request. Guards:
 * admins cannot change their own role, cannot touch owners, and cannot
 * grant a role above their own.
 */
export async function setUserRole(fd: FormData): Promise<void> {
  const { dbUser: actor } = await requireCapability("users.manage");
  const userId = str(fd, "userId");
  const roleRaw = str(fd, "role");
  if (!userId || !isRole(roleRaw)) fail("Invalid user or role.");
  const newRole = roleRaw as Role;

  if (userId === actor.id) {
    fail("You cannot change your own role.");
  }
  if (!roleAtLeast(actor.role as Role, newRole)) {
    fail("You cannot grant a role above your own.");
  }
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) fail("User not found.");
  if (target.role === "owner" && actor.role !== "owner") {
    fail("Only the owner can change the owner's role.");
  }
  if (target.role === newRole) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "user.role_changed",
      entityType: "User",
      entityId: target.id,
      before: { role: target.role, email: target.email },
    },
    async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { role: newRole, securityStamp: crypto.randomUUID() },
      });
      return { result: updated, after: { role: newRole, email: target.email } };
    },
  );

  revalidatePath("/settings/users");
}

/** Activate/deactivate a user (deactivation also invalidates their JWT). */
export async function setUserActive(fd: FormData): Promise<void> {
  const { dbUser: actor } = await requireCapability("users.manage");
  const userId = str(fd, "userId");
  const isActive = str(fd, "isActive") === "true";
  if (!userId) fail("Missing user id.");
  if (userId === actor.id) {
    fail("You cannot deactivate your own account.");
  }
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) fail("User not found.");
  if (target.role === "owner" && actor.role !== "owner") {
    fail("Only the owner can deactivate the owner.");
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: isActive ? "user.activated" : "user.deactivated",
      entityType: "User",
      entityId: target.id,
      before: { isActive: target.isActive, email: target.email },
    },
    async (tx) => {
      const updated = await tx.user.update({
        where: { id: target.id },
        data: { isActive, securityStamp: crypto.randomUUID() },
      });
      return { result: updated, after: { isActive, email: target.email } };
    },
  );

  revalidatePath("/settings/users");
}

/**
 * "View as role": admin+ can act as a lower role to verify what it sees and
 * can do. Enforcement is in effectiveRole() — the cookie can only lower
 * privileges, so it is safe to store client-side.
 */
export async function startViewAs(fd: FormData): Promise<void> {
  const { dbUser } = await requireCapability("users.manage");
  const roleRaw = str(fd, "role");
  if (!isRole(roleRaw)) fail("Invalid role.");
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "user.view_as_started",
    entityType: "User",
    entityId: dbUser.id,
    after: { viewAsRole: roleRaw },
  });
  const store = await cookies();
  store.set(VIEW_AS_COOKIE, roleRaw, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  redirect("/dashboard");
}

export async function exitViewAs(): Promise<void> {
  // No role gate: anyone holding the cookie may always drop back to themselves.
  const store = await cookies();
  const hadRole = store.get(VIEW_AS_COOKIE)?.value ?? null;
  store.delete(VIEW_AS_COOKIE);
  if (hadRole) {
    const actor = await auditActor();
    await writeAudit(prisma, {
      ...actor,
      action: "user.view_as_ended",
      entityType: "User",
      entityId: actor.actorId,
      before: { viewAsRole: hadRole },
    });
  }
  revalidatePath("/", "layout");
}

/**
 * Admin/recovery reset of a user's 2FA (Settings → Users). Clears their TOTP so
 * a staff member locked out of their authenticator + backup codes can re-enroll
 * (a break-glass owner uses this to recover too). Guards mirror role/active:
 * admins cannot reset the owner unless they ARE the owner; bumps the target's
 * security stamp. Audited in adminResetTotp.
 */
export async function resetUserTotp(fd: FormData): Promise<void> {
  const { dbUser: actor } = await requireCapability("users.manage");
  const userId = str(fd, "userId");
  if (!userId) fail("Invalid user.");
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) fail("User not found.");
  if (target.role === "owner" && actor.role !== "owner") {
    fail("Only the owner can reset the owner's two-factor authentication.");
  }
  const result = await adminResetTotp(target.id, {
    ...(await auditActor()),
  });
  if (!result.ok) fail(result.error);
  revalidatePath("/settings/users");
}

/** Admin-managed notification settings for any user (Settings → Users). */
export async function setUserNotifications(fd: FormData): Promise<void> {
  await requireCapability("users.manage");
  const userId = str(fd, "userId");
  if (!userId) fail("Invalid user.");
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) fail("User not found.");

  const phoneRaw = str(fd, "phone");
  if (phoneRaw !== "" && !/^\+?[0-9() .-]{7,20}$/.test(phoneRaw)) {
    fail("That phone number doesn't look valid.");
  }
  const data = {
    phone: phoneRaw === "" ? null : phoneRaw,
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
      entityId: target.id,
      before: {
        phone: target.phone,
        notifyOverdueDigest: target.notifyOverdueDigest,
        notifyMaintenanceDigest: target.notifyMaintenanceDigest,
        notifyLeaseExpiration: target.notifyLeaseExpiration,
        notifyCashPickup: target.notifyCashPickup,
      },
    },
    async (tx) => {
      await tx.user.update({ where: { id: target.id }, data });
      return { result: undefined, after: data };
    },
  );
  revalidatePath("/settings/users");
}
