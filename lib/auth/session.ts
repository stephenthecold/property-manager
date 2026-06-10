import "server-only";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { roleAtLeast } from "@/lib/auth/rbac";
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
  if (!roleAtLeast(dbUser.role as Role, min)) {
    throw new Error("Forbidden: insufficient role");
  }
  return { user: u, dbUser };
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
