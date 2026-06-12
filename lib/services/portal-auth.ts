import { randomBytes, randomInt } from "node:crypto";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  dummyVerify,
  hashPassword,
  sha256,
  verifyPassword,
} from "@/lib/auth/crypto";
import { emailKey, looksLikeEmail, phoneKey } from "@/lib/portal/identity";
import {
  getAppSettings,
  resolveEmailProvider,
  resolveSmsProvider,
} from "@/lib/services/app-settings";

/**
 * Tenant-portal credential service (module "tenantPortal"). LOCAL accounts —
 * tenants are never staff Users and never touch OIDC. Two login methods:
 *  - email/phone + password, set through a single-use invite/reset link
 *    (64-hex token, stored only as a sha-256 hash, like e-sign links)
 *  - phone + 6-digit one-time SMS code (hashed, 10-minute expiry, attempt-
 *    capped, resend-throttled)
 * Anti-abuse: per-account lockout after repeated password failures, constant-
 * time-ish failure paths (dummyVerify), and enumeration-safe generic results
 * on the self-service flows. Sessions are minted by the ACTIONS via
 * lib/portal/session.ts — this module never touches cookies.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const LOCKOUT_THRESHOLD = 8;
const LOCKOUT_MS = 15 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

export type PortalAuthFailure =
  | "module_disabled"
  | "invalid_link"
  | "weak_password"
  | "bad_credentials"
  | "locked"
  | "code_expired"
  | "code_invalid"
  | "resend_cooldown"
  | "sms_unavailable";

export type PortalAuthResult =
  | { ok: true; accountId: string }
  | { ok: false; code: PortalAuthFailure };

function appBaseUrl(): string {
  return getEnv().APP_URL.replace(/\/+$/, "");
}

async function portalEnabled(): Promise<boolean> {
  return (await getAppSettings()).modules.tenantPortal;
}

// ---------------------------------------------------------------------------
// Staff side: invite / re-send / enable / disable
// ---------------------------------------------------------------------------

export interface InviteResult {
  ok: boolean;
  error?: string;
  sms: "sent" | "skipped" | "failed";
  email: "sent" | "skipped" | "failed";
  /** Dev/stub convenience — the raw link is returned ONLY when nothing sent. */
  linkForOperator?: string;
}

/**
 * Create (or refresh) the tenant's portal account and send a single-use
 * set-your-password link by SMS and email. Re-running re-mints the link —
 * this doubles as "resend invite" and "send password reset" from the staff
 * side. Identifiers are canonicalized copies of the tenant's contact info.
 */
export async function invitePortalAccount(i: {
  tenantId: string;
  actor: AuditContext;
}): Promise<InviteResult> {
  if (!(await portalEnabled())) {
    return {
      ok: false,
      error: "The tenant portal module is disabled (Settings → Modules).",
      sms: "skipped",
      email: "skipped",
    };
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: i.tenantId } });
  if (!tenant) {
    return { ok: false, error: "Tenant not found.", sms: "skipped", email: "skipped" };
  }
  const email = emailKey(tenant.email);
  const phone = phoneKey(tenant.phone);
  if (!email && !phone) {
    return {
      ok: false,
      error: "This tenant has no email or phone on file — add one first.",
      sms: "skipped",
      email: "skipped",
    };
  }

  // Canonical identifiers are unique across accounts; refuse a collision with
  // ANOTHER tenant's account instead of silently stealing the login.
  for (const [field, value] of [
    ["email", email],
    ["phone", phone],
  ] as const) {
    if (!value) continue;
    const clash = await prisma.tenantPortalAccount.findFirst({
      where: { [field]: value, NOT: { tenantId: tenant.id } },
      select: { tenantId: true },
    });
    if (clash) {
      return {
        ok: false,
        error: `Another tenant's portal account already uses this ${field} — fix the contact info first.`,
        sms: "skipped",
        email: "skipped",
      };
    }
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const account = await prisma.$transaction(async (tx) => {
    const acc = await tx.tenantPortalAccount.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        email,
        phone,
        isActive: true,
        inviteTokenHash: sha256(token),
        inviteExpiresAt: expiresAt,
        createdBy: i.actor.actorId ?? null,
      },
      update: {
        email,
        phone,
        isActive: true,
        inviteTokenHash: sha256(token),
        inviteExpiresAt: expiresAt,
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "portal.invite_sent",
      entityType: "TenantPortalAccount",
      entityId: acc.id,
      after: { tenantId: tenant.id, email, phoneOnFile: !!phone },
    });
    return acc;
  });

  // Delivery (best-effort per channel) AFTER the account row is committed.
  const settings = await getAppSettings();
  const link = `${appBaseUrl()}/portal/invite/${token}`;
  const first = tenant.firstName;
  let sms: InviteResult["sms"] = "skipped";
  if (settings.smsEnabled && tenant.phone) {
    try {
      const r = await (await resolveSmsProvider()).send({
        to: tenant.phone,
        body: `${settings.businessName}: set up your tenant portal account here: ${link} (link expires in 7 days).`,
      });
      sms = r.status === "failed" ? "failed" : "sent";
    } catch (e) {
      console.error(`[portal] invite SMS failed for account ${account.id}:`, e);
      sms = "failed";
    }
  }
  let emailStatus: InviteResult["email"] = "skipped";
  if (settings.emailEnabled && email) {
    try {
      const r = await (await resolveEmailProvider()).send({
        to: email,
        subject: `Your tenant portal account — ${settings.businessName}`,
        text:
          `Hi ${first},\n\n` +
          `${settings.businessName} has set up a tenant portal where you can see your lease, balance, payment history, and receipts, and submit requests.\n\n` +
          `Choose your password here: ${link}\n\n` +
          `The link expires in 7 days and is unique to you — please don't forward it.`,
      });
      emailStatus = r.status === "failed" ? "failed" : "sent";
    } catch (e) {
      console.error(`[portal] invite email failed for account ${account.id}:`, e);
      emailStatus = "failed";
    }
  }

  return {
    ok: true,
    sms,
    email: emailStatus,
    // Nothing delivered (providers off/stubbed): give staff the link so they
    // can pass it along manually instead of dead-ending.
    linkForOperator: sms !== "sent" && emailStatus !== "sent" ? link : undefined,
  };
}

/** Enable/disable a tenant's portal login; disabling drops their sessions. */
export async function setPortalAccountActive(i: {
  tenantId: string;
  isActive: boolean;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const account = await prisma.tenantPortalAccount.findUnique({
    where: { tenantId: i.tenantId },
  });
  if (!account) return { ok: false, error: "No portal account exists for this tenant." };
  await prisma.$transaction(async (tx) => {
    await tx.tenantPortalAccount.update({
      where: { id: account.id },
      data: { isActive: i.isActive },
    });
    if (!i.isActive) {
      await tx.tenantPortalSession.deleteMany({ where: { accountId: account.id } });
    }
    await writeAudit(tx, {
      ...i.actor,
      action: i.isActive ? "portal.account_enabled" : "portal.account_disabled",
      entityType: "TenantPortalAccount",
      entityId: account.id,
      after: { tenantId: i.tenantId, isActive: i.isActive },
    });
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tenant side: accept invite / password login / SMS-code login / reset
// ---------------------------------------------------------------------------

/** Redeem an invite/reset link and set the password. Single use. */
export async function acceptPortalInvite(i: {
  token: string;
  password: string;
}): Promise<PortalAuthResult> {
  if (!(await portalEnabled())) return { ok: false, code: "module_disabled" };
  if (!/^[0-9a-f]{64}$/.test(i.token)) return { ok: false, code: "invalid_link" };
  if (i.password.length < MIN_PASSWORD_LENGTH || i.password.length > 200) {
    return { ok: false, code: "weak_password" };
  }
  const now = new Date();
  const account = await prisma.tenantPortalAccount.findUnique({
    where: { inviteTokenHash: sha256(i.token) },
    include: { tenant: { select: { isActive: true } } },
  });
  if (
    !account ||
    !account.isActive ||
    !account.tenant.isActive ||
    !account.inviteExpiresAt ||
    account.inviteExpiresAt <= now
  ) {
    return { ok: false, code: "invalid_link" };
  }

  const passwordHash = await hashPassword(i.password);
  // Single-use guard: only the first redeemer with this hash wins.
  const res = await prisma.tenantPortalAccount.updateMany({
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
  // A password (re)set invalidates every existing session — if the reset was
  // prompted by a compromised account, the intruder's session dies with it.
  await prisma.tenantPortalSession.deleteMany({ where: { accountId: account.id } });
  await writeAudit(prisma, {
    actorType: "system",
    action: "portal.invite_accepted",
    entityType: "TenantPortalAccount",
    entityId: account.id,
    after: { tenantId: account.tenantId },
  });
  return { ok: true, accountId: account.id };
}

/** Email-or-phone + password. Constant-time-ish on unknown identifiers. */
export async function loginWithPassword(i: {
  identifier: string;
  password: string;
}): Promise<PortalAuthResult> {
  if (!(await portalEnabled())) return { ok: false, code: "module_disabled" };
  const id = i.identifier.trim();
  const account = looksLikeEmail(id)
    ? await prisma.tenantPortalAccount.findUnique({
        where: { email: emailKey(id) ?? " none" },
        include: { tenant: { select: { isActive: true } } },
      })
    : await prisma.tenantPortalAccount.findUnique({
        where: { phone: phoneKey(id) ?? " none" },
        include: { tenant: { select: { isActive: true } } },
      });

  if (!account || !account.passwordHash || !account.isActive || !account.tenant.isActive) {
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
    await prisma.tenantPortalAccount.update({
      where: { id: account.id },
      data: {
        failedLogins: failed,
        lockedUntil:
          failed >= LOCKOUT_THRESHOLD ? new Date(now.getTime() + LOCKOUT_MS) : null,
      },
    });
    return { ok: false, code: "bad_credentials" };
  }

  await prisma.tenantPortalAccount.update({
    where: { id: account.id },
    data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
  });
  return { ok: true, accountId: account.id };
}

/**
 * Send a one-time login code to the account's phone. ALWAYS resolves
 * positively for unknown phones (enumeration-safe); rate-limited per account.
 */
export async function requestLoginCode(i: {
  phone: string;
}): Promise<{ ok: true } | { ok: false; code: PortalAuthFailure }> {
  if (!(await portalEnabled())) return { ok: false, code: "module_disabled" };
  const settings = await getAppSettings();
  if (!settings.smsEnabled) return { ok: false, code: "sms_unavailable" };

  const key = phoneKey(i.phone);
  const account = key
    ? await prisma.tenantPortalAccount.findUnique({
        where: { phone: key },
        include: { tenant: { select: { phone: true, isActive: true } } },
      })
    : null;
  // Unknown / inactive: pretend success so callers can't probe numbers.
  if (!account || !account.isActive || !account.tenant.isActive) return { ok: true };

  const now = new Date();
  if (
    account.otpLastSentAt &&
    now.getTime() - account.otpLastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return { ok: false, code: "resend_cooldown" };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.tenantPortalAccount.update({
    where: { id: account.id },
    data: {
      otpHash: sha256(code),
      otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
      otpAttempts: 0,
      otpLastSentAt: now,
    },
  });
  try {
    const r = await (await resolveSmsProvider()).send({
      // Send to the tenant's phone as stored (provider-friendly formatting).
      to: account.tenant.phone ?? i.phone,
      body: `${settings.businessName}: your tenant portal login code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this text.`,
    });
    if (r.status === "failed") return { ok: false, code: "sms_unavailable" };
  } catch (e) {
    console.error(`[portal] OTP send failed for account ${account.id}:`, e);
    return { ok: false, code: "sms_unavailable" };
  }
  return { ok: true };
}

/** Redeem a one-time code. Five attempts per code, then it self-destructs. */
export async function loginWithCode(i: {
  phone: string;
  code: string;
}): Promise<PortalAuthResult> {
  if (!(await portalEnabled())) return { ok: false, code: "module_disabled" };
  const key = phoneKey(i.phone);
  const account = key
    ? await prisma.tenantPortalAccount.findUnique({
        where: { phone: key },
        include: { tenant: { select: { isActive: true } } },
      })
    : null;
  if (!account || !account.isActive || !account.tenant.isActive) {
    return { ok: false, code: "code_invalid" };
  }
  const now = new Date();
  if (!account.otpHash || !account.otpExpiresAt || account.otpExpiresAt <= now) {
    return { ok: false, code: "code_expired" };
  }
  if (account.otpAttempts >= OTP_MAX_ATTEMPTS) {
    await prisma.tenantPortalAccount.update({
      where: { id: account.id },
      data: { otpHash: null, otpExpiresAt: null },
    });
    return { ok: false, code: "code_expired" };
  }
  const submitted = i.code.replace(/\D/g, "");
  if (submitted.length !== 6 || sha256(submitted) !== account.otpHash) {
    await prisma.tenantPortalAccount.update({
      where: { id: account.id },
      data: { otpAttempts: { increment: 1 } },
    });
    return { ok: false, code: "code_invalid" };
  }

  await prisma.tenantPortalAccount.update({
    where: { id: account.id },
    data: {
      otpHash: null,
      otpExpiresAt: null,
      otpAttempts: 0,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: now,
    },
  });
  return { ok: true, accountId: account.id };
}

/**
 * Tenant-initiated "forgot password": re-mints the invite/reset link and
 * sends it to the account's email and phone. ALWAYS generic-ok so the form
 * can't be used to enumerate accounts.
 */
export async function requestPasswordReset(i: {
  identifier: string;
}): Promise<{ ok: true }> {
  if (!(await portalEnabled())) return { ok: true };
  const id = i.identifier.trim();
  const account = looksLikeEmail(id)
    ? await prisma.tenantPortalAccount.findUnique({
        where: { email: emailKey(id) ?? " none" },
        include: { tenant: true },
      })
    : await prisma.tenantPortalAccount.findUnique({
        where: { phone: phoneKey(id) ?? " none" },
        include: { tenant: true },
      });
  if (!account || !account.isActive || !account.tenant.isActive) return { ok: true };

  // Throttle link minting with the OTP resend clock (shared cooldown).
  const now = new Date();
  if (
    account.otpLastSentAt &&
    now.getTime() - account.otpLastSentAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    return { ok: true };
  }

  const token = randomBytes(32).toString("hex");
  await prisma.tenantPortalAccount.update({
    where: { id: account.id },
    data: {
      inviteTokenHash: sha256(token),
      inviteExpiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      otpLastSentAt: now,
    },
  });
  const settings = await getAppSettings();
  const link = `${appBaseUrl()}/portal/invite/${token}`;
  if (settings.smsEnabled && account.tenant.phone) {
    try {
      await (await resolveSmsProvider()).send({
        to: account.tenant.phone,
        body: `${settings.businessName}: reset your tenant portal password here: ${link}`,
      });
    } catch (e) {
      console.error(`[portal] reset SMS failed for account ${account.id}:`, e);
    }
  }
  if (settings.emailEnabled && account.email) {
    try {
      await (await resolveEmailProvider()).send({
        to: account.email,
        subject: `Password reset — ${settings.businessName}`,
        text: `Hi ${account.tenant.firstName},\n\nReset your tenant portal password here: ${link}\n\nThe link expires in 7 days. If you didn't request this, you can ignore it.`,
      });
    } catch (e) {
      console.error(`[portal] reset email failed for account ${account.id}:`, e);
    }
  }
  return { ok: true };
}
