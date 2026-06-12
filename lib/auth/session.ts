import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { effectiveRole, roleAtLeast } from "@/lib/auth/rbac";
import { getViewAsRole } from "@/lib/auth/view-as";
import type { Role } from "@/lib/generated/prisma/enums";

export type SessionUser = Session["user"];

/** Current session user, or null. Treats an expired break-glass session as logged out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  if (u.viaBreakGlass && u.bgExpiresAt && Date.now() > u.bgExpiresAt) return null;
  return u;
}

/** Require a logged-in user (redirects to /login otherwise). Coarse check. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}

/**
 * Authoritative role check for sensitive/destructive actions: re-reads the user
 * from the DB, verifies isActive + securityStamp (revocation), and enforces the
 * minimum role. The JWT role is only a hint; this is the real gate.
 *
 * Honors "view as role": an admin+ user impersonating a lower role is checked
 * at the LOWER role, so they experience exactly what that role can do.
 * `effectiveRole` guarantees the cookie can only ever lower privileges.
 */
export async function requireRole(min: Role): Promise<{
  user: SessionUser;
  dbUser: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;
}> {
  const u = await requireUser();
  const dbUser = await prisma.user.findUnique({ where: { id: u.id } });
  if (!dbUser || !dbUser.isActive) redirect("/login");
  // securityStamp mismatch => the token was invalidated (role change / disable).
  if (u.securityStamp && dbUser.securityStamp !== u.securityStamp) {
    redirect("/login");
  }
  const acting = effectiveRole(dbUser.role as Role, await getViewAsRole());
  if (!roleAtLeast(acting, min)) {
    throw new Error("Forbidden: insufficient role");
  }
  return { user: u, dbUser };
}

/**
 * API-route variant of requireRole. Never redirects (wrong for fetch/XHR) —
 * returns the DB user on success or an HTTP status to send otherwise. Uses the
 * true DB role (not view-as): impersonation is a UI affordance, not an API one.
 */
export async function authorizeApiRole(min: Role): Promise<
  | { ok: true; user: SessionUser; dbUser: NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>> }
  | { ok: false; status: 401 | 403 }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, status: 401 };
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser || !dbUser.isActive || !roleAtLeast(dbUser.role as Role, min)) {
    return { ok: false, status: 403 };
  }
  // securityStamp mismatch => the token was invalidated (role change / disable).
  if (user.securityStamp && dbUser.securityStamp !== user.securityStamp) {
    return { ok: false, status: 401 };
  }
  return { ok: true, user, dbUser };
}

/**
 * The role the current user is ACTING as (JWT hint + view-as cookie). For
 * nav/UI gating only — actions must still go through requireRole.
 */
export async function getDisplayRole(): Promise<{
  user: SessionUser;
  actingRole: Role;
  viewAs: Role | null;
}> {
  const u = await requireUser();
  const viewAs = await getViewAsRole();
  const acting = effectiveRole(u.role as Role, viewAs);
  return { user: u, actingRole: acting, viewAs: acting !== u.role ? viewAs : null };
}

/** Audit context (actor) derived from the current session. */
export async function auditActor(): Promise<{
  actorType: "user" | "breakglass";
  actorId: string;
  actorEmail: string | null;
  viaBreakGlass: boolean;
}> {
  const u = await requireUser();
  return {
    actorType: u.viaBreakGlass ? "breakglass" : "user",
    actorId: u.id,
    actorEmail: u.email ?? null,
    viaBreakGlass: !!u.viaBreakGlass,
  };
}
