import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/auth/crypto";
import { getAppSettings } from "@/lib/services/app-settings";
import type {
  Tenant,
  TenantPortalAccount,
} from "@/lib/generated/prisma/client";

/**
 * Tenant-portal sessions — a completely separate lane from staff auth: opaque
 * 256-bit bearer tokens in an httpOnly cookie, stored ONLY as sha-256 hashes
 * in TenantPortalSession (mirroring e-sign link tokens), resolved per request
 * against the DB. No JWTs, no NextAuth, no staff User rows. /portal is a
 * staff-middleware PUBLIC_PREFIX, so THIS module is the portal's entire gate:
 * every portal page and action goes through requirePortalSession /
 * getPortalSession.
 */

export const PORTAL_COOKIE = "pm_portal_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Impersonation sessions are deliberately short-lived. */
export const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface PortalIdentity {
  account: TenantPortalAccount;
  tenant: Tenant;
  /** Staff user id when a staff member is impersonating; null for a real login. */
  impersonatedByUserId: string | null;
}

/** Mint + persist a session for an account and set the cookie. */
export async function createPortalSession(
  accountId: string,
  ip: string | null,
  userAgent: string | null,
  opts?: { impersonatedByUserId?: string | null; ttlMs?: number },
): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + (opts?.ttlMs ?? SESSION_TTL_MS));
  await prisma.tenantPortalSession.create({
    data: {
      accountId,
      tokenHash: sha256(token),
      expiresAt,
      ip,
      userAgent: userAgent?.slice(0, 400) ?? null,
      impersonatedByUserId: opts?.impersonatedByUserId ?? null,
    },
  });
  const store = await cookies();
  store.set(PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Resolve the current portal identity, or null. Enforces: valid unexpired
 * session row, account active, tenant active, and the tenantPortal module
 * switched on (disabling the module locks tenants out immediately — data and
 * sessions are kept, so re-enabling restores access).
 */
export async function getPortalSession(): Promise<PortalIdentity | null> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;

  const { modules } = await getAppSettings();
  if (!modules.tenantPortal) return null;

  const session = await prisma.tenantPortalSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { account: { include: { tenant: true } } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  const { account } = session;
  // Impersonation sessions are staff-minted for debugging, so the account's
  // own active flag (a tenant-login control) doesn't gate them — but the tenant
  // must still be active and the module on (both checked here / above).
  const impersonated = session.impersonatedByUserId;
  if ((!account.isActive && !impersonated) || !account.tenant.isActive) return null;
  return { account, tenant: account.tenant, impersonatedByUserId: impersonated };
}

/** Require a signed-in tenant; redirects to the portal login otherwise. */
export async function requirePortalSession(): Promise<PortalIdentity> {
  const identity = await getPortalSession();
  if (!identity) redirect("/portal/login");
  return identity;
}

/** Sign out: delete the session row (best effort) and clear the cookie. */
export async function destroyPortalSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(PORTAL_COOKIE)?.value;
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await prisma.tenantPortalSession
      .deleteMany({ where: { tokenHash: sha256(token) } })
      .catch(() => undefined);
  }
  store.delete(PORTAL_COOKIE);
}

/** Sign out everywhere: drop every session for the account (e.g. on disable). */
export async function destroyAllSessionsForAccount(
  accountId: string,
): Promise<void> {
  await prisma.tenantPortalSession.deleteMany({ where: { accountId } });
}
