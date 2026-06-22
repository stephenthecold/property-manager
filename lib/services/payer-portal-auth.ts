import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  dummyVerify,
  hashPassword,
  sha256,
  verifyPassword,
} from "@/lib/auth/crypto";
import { emailKey } from "@/lib/portal/identity";
import { getAppSettings, resolveEmailProvider } from "@/lib/services/app-settings";

/**
 * Payer-portal credential service. LOCAL accounts — a payer (e.g. a housing
 * authority) is never a staff User or a tenant. Sign-in is email + password,
 * set through a single-use invite/reset link (64-hex token stored only as a
 * sha-256 hash). Per-account lockout, constant-time-ish failure (dummyVerify),
 * and enumeration-safe self-service. Sessions are minted by the ACTIONS via
 * lib/payer-portal/session.ts — this module never touches cookies.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

export type PayerAuthFailure =
  | "module_disabled"
  | "invalid_link"
  | "weak_password"
  | "bad_credentials"
  | "locked";

async function payerPortalEnabled(): Promise<boolean> {
  return (await getAppSettings()).modules.payerPortal;
}

export type PayerAuthResult =
  | { ok: true; accountId: string }
  | { ok: false; code: PayerAuthFailure };

function appBaseUrl(): string {
  return getEnv().APP_URL.replace(/\/+$/, "");
}

export interface PayerInviteResult {
  ok: boolean;
  error?: string;
  email: "sent" | "skipped" | "failed";
  /** Returned ONLY when nothing was delivered, so staff can share it manually. */
  linkForOperator?: string;
}

/**
 * Create (or refresh) a payer's portal account and email a single-use
 * set-your-password link. Re-running re-mints the link, doubling as "resend
 * invite" / "send password reset". Requires an email on the payer.
 */
export async function invitePayerPortalAccount(i: {
  payerId: string;
  actor: AuditContext;
}): Promise<PayerInviteResult> {
  if (!(await payerPortalEnabled())) {
    return {
      ok: false,
      error: "The payer portal module is disabled (Settings → Modules).",
      email: "skipped",
    };
  }
  const payer = await prisma.payer.findUnique({ where: { id: i.payerId } });
  if (!payer) return { ok: false, error: "Payer not found.", email: "skipped" };
  if (!payer.isActive) {
    return { ok: false, error: "This payer is inactive — reactivate it first.", email: "skipped" };
  }
  const email = emailKey(payer.email);
  if (!email) {
    return {
      ok: false,
      error: "This payer has no email on file — add one first.",
      email: "skipped",
    };
  }

  // Canonical email is unique across accounts; refuse a collision with ANOTHER
  // payer's account instead of silently stealing the login.
  const clash = await prisma.payerPortalAccount.findFirst({
    where: { email, NOT: { payerId: payer.id } },
    select: { payerId: true },
  });
  if (clash) {
    return {
      ok: false,
      error: "Another payer's portal account already uses this email.",
      email: "skipped",
    };
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const account = await prisma.$transaction(async (tx) => {
    const acc = await tx.payerPortalAccount.upsert({
      where: { payerId: payer.id },
      create: {
        payerId: payer.id,
        email,
        isActive: true,
        inviteTokenHash: sha256(token),
        inviteExpiresAt: expiresAt,
        createdBy: i.actor.actorId ?? null,
      },
      update: {
        email,
        isActive: true,
        inviteTokenHash: sha256(token),
        inviteExpiresAt: expiresAt,
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "payer_portal.invite_sent",
      entityType: "PayerPortalAccount",
      entityId: acc.id,
      after: { payerId: payer.id, email },
    });
    return acc;
  });

  const settings = await getAppSettings();
  // Public site (Settings → Public site) when configured, else the staff host —
  // mirrors the tenant portal so payer invites land on the public brand too.
  const base = settings.publicSiteUrl?.trim().replace(/\/+$/, "") || appBaseUrl();
  const link = `${base}/payer-portal/invite/${token}`;
  let emailStatus: PayerInviteResult["email"] = "skipped";
  if (settings.emailEnabled) {
    try {
      const r = await (await resolveEmailProvider()).send({
        to: email,
        subject: `Your payer portal account — ${settings.businessName}`,
        text:
          `Hello,\n\n` +
          `${settings.businessName} has set up a payer portal where ${payer.name} can see the leases you pay toward and what is expected and received.\n\n` +
          `Choose your password here: ${link}\n\n` +
          `The link expires in 7 days and is unique to your organization — please don't forward it.`,
      });
      emailStatus = r.status === "failed" ? "failed" : "sent";
    } catch (e) {
      console.error(`[payer-portal] invite email failed for account ${account.id}:`, e);
      emailStatus = "failed";
    }
  }

  return {
    ok: true,
    email: emailStatus,
    linkForOperator: emailStatus !== "sent" ? link : undefined,
  };
}

/** Enable/disable a payer's portal login; disabling drops their sessions. */
export async function setPayerPortalAccountActive(i: {
  payerId: string;
  isActive: boolean;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const account = await prisma.payerPortalAccount.findUnique({
    where: { payerId: i.payerId },
  });
  if (!account) return { ok: false, error: "No portal account exists for this payer." };
  await prisma.$transaction(async (tx) => {
    await tx.payerPortalAccount.update({
      where: { id: account.id },
      data: { isActive: i.isActive },
    });
    if (!i.isActive) {
      await tx.payerPortalSession.deleteMany({ where: { accountId: account.id } });
    }
    await writeAudit(tx, {
      ...i.actor,
      action: i.isActive ? "payer_portal.account_enabled" : "payer_portal.account_disabled",
      entityType: "PayerPortalAccount",
      entityId: account.id,
      after: { payerId: i.payerId, isActive: i.isActive },
    });
  });
  return { ok: true };
}

/** Redeem an invite/reset link and set the password. Single use. */
export async function acceptPayerInvite(i: {
  token: string;
  password: string;
}): Promise<PayerAuthResult> {
  if (!(await payerPortalEnabled())) return { ok: false, code: "module_disabled" };
  if (!/^[0-9a-f]{64}$/.test(i.token)) return { ok: false, code: "invalid_link" };
  if (i.password.length < MIN_PASSWORD_LENGTH || i.password.length > 200) {
    return { ok: false, code: "weak_password" };
  }
  const now = new Date();
  const account = await prisma.payerPortalAccount.findUnique({
    where: { inviteTokenHash: sha256(i.token) },
    include: { payer: { select: { isActive: true } } },
  });
  if (
    !account ||
    !account.isActive ||
    !account.payer.isActive ||
    !account.inviteExpiresAt ||
    account.inviteExpiresAt <= now
  ) {
    return { ok: false, code: "invalid_link" };
  }

  const passwordHash = await hashPassword(i.password);
  // Single-use guard: only the first redeemer with this hash wins.
  const res = await prisma.payerPortalAccount.updateMany({
    where: { id: account.id, inviteTokenHash: sha256(i.token) },
    data: {
      passwordHash,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: now,
    },
  });
  if (res.count === 0) return { ok: false, code: "invalid_link" };
  // A password (re)set invalidates every existing session.
  await prisma.payerPortalSession.deleteMany({ where: { accountId: account.id } });
  await writeAudit(prisma, {
    actorType: "system",
    action: "payer_portal.invite_accepted",
    entityType: "PayerPortalAccount",
    entityId: account.id,
    after: { payerId: account.payerId },
  });
  return { ok: true, accountId: account.id };
}

/** Email + password. Constant-time-ish on unknown identifiers. */
export async function loginPayerWithPassword(i: {
  email: string;
  password: string;
}): Promise<PayerAuthResult> {
  if (!(await payerPortalEnabled())) return { ok: false, code: "module_disabled" };
  const account = await prisma.payerPortalAccount.findUnique({
    where: { email: emailKey(i.email) ?? " none" },
    include: { payer: { select: { isActive: true } } },
  });

  if (!account || !account.passwordHash || !account.isActive || !account.payer.isActive) {
    await dummyVerify(i.password);
    return { ok: false, code: "bad_credentials" };
  }
  const now = new Date();
  if (account.lockedUntil && account.lockedUntil > now) {
    return { ok: false, code: "locked" };
  }

  const valid = await verifyPassword(account.passwordHash, i.password);
  if (!valid) {
    const failed = account.failedLogins + 1;
    await prisma.payerPortalAccount.update({
      where: { id: account.id },
      data: {
        failedLogins: failed,
        lockedUntil:
          failed >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_MS) : null,
      },
    });
    return { ok: false, code: "bad_credentials" };
  }

  await prisma.payerPortalAccount.update({
    where: { id: account.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
  });
  return { ok: true, accountId: account.id };
}
