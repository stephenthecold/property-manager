import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { sha256 } from "@/lib/auth/crypto";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { createPortalSession, IMPERSONATION_TTL_MS } from "@/lib/portal/session";

/**
 * Tenant impersonation (capability portal.impersonate) — staff open the portal
 * AS a tenant for debugging/smoke testing. Sessions are short-lived, audited,
 * and banner-marked (lib/portal/session.ts impersonatedByUserId). A "trial
 * login" is a single-use, short-lived link that does the same on visit.
 */

const TRIAL_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Reuse the tenant's portal account, or create a minimal login-disabled one. */
async function getOrCreateAccountId(tenantId: string): Promise<string> {
  const existing = await prisma.tenantPortalAccount.findUnique({
    where: { tenantId },
    select: { id: true },
  });
  if (existing) return existing.id;
  // No login identifiers / password → the tenant still can't log in normally;
  // the account exists only to anchor impersonation sessions.
  const created = await prisma.tenantPortalAccount.create({
    data: { tenantId, isActive: false, createdBy: "impersonation" },
  });
  return created.id;
}

/** Mint an impersonation portal session for `tenantId` (sets the cookie). Audited. */
export async function startImpersonation(
  tenantId: string,
  byUserId: string | null,
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  await assertModuleEnabled("tenantPortal");
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, isActive: true },
  });
  if (!tenant) throw new Error("Tenant not found.");
  if (!tenant.isActive) throw new Error("This tenant is inactive.");

  const accountId = await getOrCreateAccountId(tenantId);
  await createPortalSession(accountId, ip, userAgent, {
    impersonatedByUserId: byUserId,
    ttlMs: IMPERSONATION_TTL_MS,
  });
  await writeAudit(prisma, {
    actorType: "user",
    actorId: byUserId,
    action: "impersonation.started",
    entityType: "Tenant",
    entityId: tenantId,
    after: { ttlMinutes: IMPERSONATION_TTL_MS / 60000 },
  });
}

/** Create a single-use trial-login token; returns the RAW token (link only). Audited. */
export async function createTrialToken(
  tenantId: string,
  byUserId: string | null,
  actor: AuditContext,
): Promise<string> {
  await assertModuleEnabled("tenantPortal");
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (!tenant) throw new Error("Tenant not found.");

  const raw = randomBytes(32).toString("hex");
  await prisma.tenantPortalTrialToken.create({
    data: {
      tenantId,
      tokenHash: sha256(raw),
      createdByUserId: byUserId,
      expiresAt: new Date(Date.now() + TRIAL_TTL_MS),
    },
  });
  await writeAudit(prisma, {
    ...actor,
    action: "impersonation.trial_created",
    entityType: "Tenant",
    entityId: tenantId,
    after: { ttlMinutes: TRIAL_TTL_MS / 60000 },
  });
  return raw;
}

/** Consume a trial token: validate + single-use claim + start impersonation. */
export async function consumeTrialToken(
  rawToken: string,
  ip: string | null,
  userAgent: string | null,
): Promise<{ ok: true; tenantId: string } | { ok: false }> {
  if (!/^[0-9a-f]{64}$/.test(rawToken)) return { ok: false };
  const row = await prisma.tenantPortalTrialToken.findUnique({
    where: { tokenHash: sha256(rawToken) },
  });
  if (!row || row.usedAt || row.expiresAt <= new Date()) return { ok: false };

  // Atomic single-use claim guards against double-spend / races.
  const claimed = await prisma.tenantPortalTrialToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false };

  await startImpersonation(row.tenantId, row.createdByUserId, ip, userAgent);
  await writeAudit(prisma, {
    actorType: "user",
    actorId: row.createdByUserId,
    action: "impersonation.trial_used",
    entityType: "Tenant",
    entityId: row.tenantId,
  });
  return { ok: true, tenantId: row.tenantId };
}
