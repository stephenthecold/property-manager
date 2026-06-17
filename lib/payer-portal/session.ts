import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/auth/crypto";
import { getAppSettings } from "@/lib/services/app-settings";
import type { Payer, PayerPortalAccount } from "@/lib/generated/prisma/client";

/**
 * Payer-portal sessions — a separate lane from staff AND tenant auth: opaque
 * 256-bit bearer tokens in an httpOnly cookie, stored ONLY as sha-256 hashes in
 * PayerPortalSession, resolved per request against the DB. No JWTs, no NextAuth,
 * no staff User rows, no tenant accounts. /payer-portal is a staff-middleware
 * PUBLIC_PREFIX, so THIS module is the portal's entire gate: every payer-portal
 * page and action goes through requirePayerSession / getPayerSession.
 */

export const PAYER_PORTAL_COOKIE = "pm_payer_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface PayerIdentity {
  account: PayerPortalAccount;
  payer: Payer;
}

/** Mint + persist a session for an account and set the cookie. */
export async function createPayerSession(
  accountId: string,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.payerPortalSession.create({
    data: {
      accountId,
      tokenHash: sha256(token),
      expiresAt,
      ip,
      userAgent: userAgent?.slice(0, 400) ?? null,
    },
  });
  const store = await cookies();
  store.set(PAYER_PORTAL_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Resolve the current payer-portal identity, or null. Enforces: valid unexpired
 * session row, account active, and payer active.
 */
export async function getPayerSession(): Promise<PayerIdentity | null> {
  const store = await cookies();
  const token = store.get(PAYER_PORTAL_COOKIE)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;

  // Module off → locked out immediately (data + sessions kept, like /portal).
  const { modules } = await getAppSettings();
  if (!modules.payerPortal) return null;

  const session = await prisma.payerPortalSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { account: { include: { payer: true } } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  const { account } = session;
  if (!account.isActive || !account.payer.isActive) return null;
  return { account, payer: account.payer };
}

/** Require a signed-in payer; redirects to the payer-portal login otherwise. */
export async function requirePayerSession(): Promise<PayerIdentity> {
  const identity = await getPayerSession();
  if (!identity) redirect("/payer-portal/login");
  return identity;
}

/** Sign out: delete the session row (best effort) and clear the cookie. */
export async function destroyPayerSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(PAYER_PORTAL_COOKIE)?.value;
  if (token && /^[0-9a-f]{64}$/.test(token)) {
    await prisma.payerPortalSession
      .deleteMany({ where: { tokenHash: sha256(token) } })
      .catch(() => undefined);
  }
  store.delete(PAYER_PORTAL_COOKIE);
}
