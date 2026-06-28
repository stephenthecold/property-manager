import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { effectiveRole, roleAtLeast } from "@/lib/auth/rbac";
import { getViewAsRole } from "@/lib/auth/view-as";
import { hasCapability, type Capability } from "@/lib/auth/permissions";
import { getAppSettings, assertModuleEnabled } from "@/lib/services/app-settings";
import type { Role } from "@/lib/generated/prisma/enums";

type DbUser = NonNullable<Awaited<ReturnType<typeof prisma.user.findUnique>>>;

export type SessionUser = Session["user"];

/** Current session user, or null. Treats an expired break-glass session as logged out. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  if (u.viaBreakGlass && u.bgExpiresAt && Date.now() > u.bgExpiresAt) return null;
  return u;
}

/**
 * Whether a session still owes a 2FA step before it may use the app. Two cases:
 *  - `pending`: the user is enrolled and primary auth succeeded but the TOTP
 *    challenge hasn't been passed (token.twoFactorPending). → /2fa
 *  - `enroll`: org enforcement (require2fa) is ON and this user is NOT enrolled.
 *    → /2fa/enroll
 * Break-glass is ALWAYS exempt (recovery lane). Returns the path to send the
 * user to, or null when the session is fully cleared for app use.
 *
 * Fails OPEN only for the require2fa lookup (a settings read error must not lock
 * everyone out of an app that wasn't enforcing 2FA); the `pending` gate, which
 * is the real second factor, always fails CLOSED.
 */
export async function twoFactorRedirect(u: SessionUser): Promise<string | null> {
  if (u.viaBreakGlass) return null; // recovery lane — never gated
  // Enrolled user mid-login who hasn't passed the challenge: hard gate.
  if (u.twoFactorPending) return "/2fa";
  // Org-enforced enrollment for users who haven't set up 2FA yet.
  try {
    const { require2fa } = await getAppSettings();
    if (require2fa) {
      const dbUser = await prisma.user.findUnique({
        where: { id: u.id },
        select: { totpConfirmedAt: true },
      });
      if (!dbUser?.totpConfirmedAt) return "/2fa/enroll";
    }
  } catch {
    // Settings unreadable — do not invent an enforcement that wasn't configured.
  }
  return null;
}

/**
 * Require a logged-in user (redirects to /login otherwise). Also enforces the
 * 2FA gate: a session that still owes a TOTP challenge or forced enrollment is
 * redirected to /2fa(/enroll) before it can reach any app page. Break-glass is
 * exempt. This is the universal app-page chokepoint (the (app) layout calls it
 * via getDisplayRole), so the gate covers every protected page in one place.
 */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  const to = await twoFactorRedirect(u);
  if (to) redirect(to);
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
  dbUser: DbUser;
}> {
  const { user, dbUser, acting } = await authenticatedUser();
  if (!roleAtLeast(acting, min)) {
    throw new Error("Forbidden: insufficient role");
  }
  return { user, dbUser };
}

/**
 * Authoritative capability check (the matrix layered over roles). Same identity
 * verification as requireRole, then enforces a specific capability using the
 * acting role and the saved permission matrix. Use this in mutations/sensitive
 * pages instead of requireRole so permissions are configurable per role.
 */
export async function requireCapability(cap: Capability): Promise<{
  user: SessionUser;
  dbUser: DbUser;
}> {
  const { user, dbUser, acting } = await authenticatedUser();
  const { rolePermissions } = await getAppSettings();
  if (!hasCapability(acting, cap, rolePermissions)) {
    throw new Error(`Forbidden: missing capability ${cap}`);
  }
  return { user, dbUser };
}

/**
 * requireCapability + assert the optional feature module is enabled — the gate
 * prelude module-gated actions (maintenance, vendors, assets, inspections) all
 * run. Returns the same { user, dbUser } as requireCapability so call sites that
 * need dbUser keep it.
 */
export async function requireModuleCapability(
  cap: Capability,
  module: Parameters<typeof assertModuleEnabled>[0],
): Promise<{ user: SessionUser; dbUser: DbUser }> {
  const res = await requireCapability(cap);
  await assertModuleEnabled(module);
  return res;
}

/**
 * API-route capability check. Never redirects; returns the DB user or an HTTP
 * status. Uses the true DB role (impersonation is a UI affordance, not an API).
 */
export async function authorizeApiCapability(cap: Capability): Promise<
  | { ok: true; user: SessionUser; dbUser: DbUser }
  | { ok: false; status: 401 | 403 }
> {
  const auth = await authorizeApiRole("viewer");
  if (!auth.ok) return auth;
  const { rolePermissions } = await getAppSettings();
  if (!hasCapability(auth.dbUser.role as Role, cap, rolePermissions)) {
    return { ok: false, status: 403 };
  }
  return auth;
}

/**
 * Shared identity verification: re-read the user from the DB, enforce isActive
 * and securityStamp (revocation), and resolve the acting role (with view-as).
 */
async function authenticatedUser(): Promise<{
  user: SessionUser;
  dbUser: DbUser;
  acting: Role;
}> {
  const u = await requireUser();
  const dbUser = await prisma.user.findUnique({ where: { id: u.id } });
  if (!dbUser || !dbUser.isActive) redirect("/login");
  // securityStamp mismatch => the token was invalidated (role change / disable).
  if (u.securityStamp && dbUser.securityStamp !== u.securityStamp) {
    redirect("/login");
  }
  const acting = effectiveRole(dbUser.role as Role, await getViewAsRole());
  return { user: u, dbUser, acting };
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
  // A session still owing its 2FA challenge is not authorized for the API
  // (fail closed). Break-glass is exempt (twoFactorPending is never set for it).
  if (user.twoFactorPending) return { ok: false, status: 401 };
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
