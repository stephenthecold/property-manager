import { prisma } from "@/lib/db";
import { encryptSecret, decryptSecret, hmacSign, hmacVerify } from "@/lib/auth/crypto";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  generateSecret,
  verifyTotp,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
  unusedBackupCodeCount,
  isTotpLocked,
  totpLockUntil,
  type StoredBackupCode,
} from "@/lib/auth/totp";

/**
 * DB bridge for staff TOTP 2FA. The pure crypto/algorithm lives in
 * lib/auth/totp.ts (DB-free, unit-tested); this module persists the encrypted
 * secret + hashed backup codes, runs enrollment/disable in audited
 * transactions, and verifies a login challenge. Mirrors how app-settings.ts
 * handles the SMS/email secrets: AES-256-GCM at rest with SETTINGS_ENC_KEY,
 * never logged or audited in the clear.
 *
 * Security stamp: enrolling or disabling 2FA bumps the user's securityStamp so
 * any outstanding JWT is invalidated (defense-in-depth — matches role/disable
 * changes in settings/users/actions.ts).
 */

/** AAD binding the encrypted TOTP secret to this user's row/field (GCM transplant protection). */
function totpAad(userId: string): string {
  return `user:totpSecret:${userId}`;
}

/**
 * Unforgeable proof that a 2FA step was passed for THIS user+session, used to
 * clear the login gate through NextAuth's session-update channel (whose body is
 * client-influenced). Bound to the user id AND their current securityStamp:
 * a client cannot compute it (no server secret), it cannot be replayed after a
 * stamp bump, and it cannot be moved to another user. See auth.ts jwt(update).
 */
export function twoFactorProof(userId: string, securityStamp: string): string {
  return hmacSign(`2fa-verified:${userId}:${securityStamp}`);
}

/** Verify a {@link twoFactorProof} for the given user+stamp (constant-time). */
export function verifyTwoFactorProof(
  userId: string,
  securityStamp: string,
  proof: string,
): boolean {
  return hmacVerify(`2fa-verified:${userId}:${securityStamp}`, proof);
}

/** Return the proof for a user by id (re-reads their current securityStamp). */
export async function issueTwoFactorProof(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { securityStamp: true },
  });
  if (!user) return null;
  return twoFactorProof(userId, user.securityStamp);
}

function bumpStamp(): string {
  return crypto.randomUUID();
}

/** Minimal shape we read for 2FA decisions (the full User has much more). */
interface TotpUserRow {
  id: string;
  totpSecretCiphertext: string | null;
  totpSecretNonce: string | null;
  totpSecretTag: string | null;
  totpConfirmedAt: Date | null;
  totpBackupCodes: unknown;
}

/** Decrypt the stored secret for a user, or null if none/!decryptable. */
function decryptSecretFor(user: TotpUserRow): string | null {
  if (!user.totpSecretCiphertext || !user.totpSecretNonce || !user.totpSecretTag) {
    return null;
  }
  try {
    return decryptSecret(
      {
        ciphertext: user.totpSecretCiphertext,
        nonce: user.totpSecretNonce,
        tag: user.totpSecretTag,
      },
      totpAad(user.id),
    );
  } catch {
    return null;
  }
}

/** Parse the stored backup-code JSON into a typed array (robust to garbage). */
export function parseBackupCodes(raw: unknown): StoredBackupCode[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c): c is StoredBackupCode =>
      !!c &&
      typeof c === "object" &&
      typeof (c as { hash?: unknown }).hash === "string",
  );
}

export interface TotpStatus {
  enrolled: boolean;
  backupCodesRemaining: number;
}

/** Whether the user has confirmed 2FA, and how many backup codes are left. */
export async function getTotpStatus(userId: string): Promise<TotpStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpConfirmedAt: true, totpBackupCodes: true },
  });
  return {
    enrolled: !!user?.totpConfirmedAt,
    backupCodesRemaining: unusedBackupCodeCount(parseBackupCodes(user?.totpBackupCodes)),
  };
}

/**
 * Begin (or restart) enrollment: generate a fresh secret, store it ENCRYPTED but
 * leave totpConfirmedAt NULL (not yet active), and return the base32 secret so
 * the page can render the QR/otpauth URL. Safe to call repeatedly before
 * confirmation — it rotates the pending secret and is a no-op on confirmed
 * users handled by the caller. Not audited (no security state changes until
 * confirm).
 */
export async function beginTotpEnrollment(userId: string): Promise<{ secret: string }> {
  const secret = generateSecret();
  const enc = encryptSecret(secret, totpAad(userId));
  await prisma.user.update({
    where: { id: userId },
    data: {
      totpSecretCiphertext: enc.ciphertext,
      totpSecretNonce: enc.nonce,
      totpSecretTag: enc.tag,
      totpConfirmedAt: null,
    },
  });
  return { secret };
}

/**
 * Get the user's current PENDING (unconfirmed) secret, or mint+store a fresh one
 * if none exists. Idempotent across page refreshes so a half-scanned QR stays
 * valid: only generates when there is no stored pending secret. Returns null-safe
 * by always returning a usable base32 secret. Throws if the user is already
 * confirmed (callers should not offer enrollment then).
 */
export async function getOrCreatePendingSecret(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found.");
  if (user.totpConfirmedAt) {
    throw new Error("Two-factor authentication is already enabled.");
  }
  const existing = decryptSecretFor(user);
  if (existing) return existing;
  return (await beginTotpEnrollment(userId)).secret;
}

export type ConfirmResult =
  | { ok: true; backupCodes: string[] }
  | { ok: false; error: string };

/**
 * Confirm enrollment: verify a live code against the pending secret, and only
 * then mark totpConfirmedAt, generate one-time backup codes (hashed), and bump
 * the security stamp. Returns the plaintext backup codes ONCE for display.
 * Audited. Fails closed on a wrong/expired/absent secret.
 */
export async function confirmTotpEnrollment(
  userId: string,
  code: string,
  actor: AuditContext,
  now: Date = new Date(),
): Promise<ConfirmResult> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found." };
  if (user.totpConfirmedAt) {
    return { ok: false, error: "Two-factor authentication is already enabled." };
  }
  const secret = decryptSecretFor(user);
  if (!secret) {
    return { ok: false, error: "Start setup again — no pending secret was found." };
  }
  if (!verifyTotp(secret, code, now)) {
    return { ok: false, error: "That code is incorrect or expired. Try again." };
  }

  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpConfirmedAt: now,
        totpBackupCodes: hashed as unknown as object,
        securityStamp: bumpStamp(),
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: "user.totp.enrolled",
      entityType: "User",
      entityId: userId,
      after: { backupCodesIssued: backupCodes.length },
    });
  });
  return { ok: true, backupCodes };
}

/**
 * Disable 2FA for a user. Requires a valid current code OR backup code (re-auth)
 * — the caller passes the proof; we re-verify here. Clears the secret, the
 * confirmation, and the backup codes, and bumps the security stamp. Audited.
 */
export async function disableTotp(
  userId: string,
  proofCode: string,
  actor: AuditContext,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false, error: "User not found." };
  if (!user.totpConfirmedAt) {
    return { ok: false, error: "Two-factor authentication is not enabled." };
  }
  const verified = await verifyChallengeForUser(user, proofCode, now);
  if (!verified.ok) {
    return { ok: false, error: "That code is incorrect or expired. Try again." };
  }
  await prisma.$transaction(async (tx) => {
    // If a backup code was consumed to authorize this, it no longer matters
    // (we clear them all), so persist the cleared state directly.
    await tx.user.update({
      where: { id: userId },
      data: {
        totpSecretCiphertext: null,
        totpSecretNonce: null,
        totpSecretTag: null,
        totpConfirmedAt: null,
        totpBackupCodes: undefined,
        securityStamp: bumpStamp(),
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: "user.totp.disabled",
      entityType: "User",
      entityId: userId,
      after: { via: verified.via },
    });
  });
  return { ok: true };
}

/**
 * Regenerate backup codes (invalidating the old set). Requires the user to be
 * enrolled. Returns the new plaintext codes ONCE. Audited.
 */
export async function regenerateBackupCodes(
  userId: string,
  actor: AuditContext,
): Promise<{ ok: true; backupCodes: string[] } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpConfirmedAt: true },
  });
  if (!user?.totpConfirmedAt) {
    return { ok: false, error: "Enable two-factor authentication first." };
  }
  const backupCodes = generateBackupCodes();
  const hashed = await hashBackupCodes(backupCodes);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { totpBackupCodes: hashed as unknown as object },
    });
    await writeAudit(tx, {
      ...actor,
      action: "user.totp.backup_codes_regenerated",
      entityType: "User",
      entityId: userId,
      after: { backupCodesIssued: backupCodes.length },
    });
  });
  return { ok: true, backupCodes };
}

/**
 * Admin/recovery reset: clear a user's 2FA WITHOUT a code. For an
 * administrator (or a break-glass owner) unlocking a staff member who lost both
 * their authenticator and backup codes. Clears the secret, confirmation, and
 * backup codes, and bumps the security stamp. Authorization (admin/owner, owner
 * protection) is enforced by the caller; this only performs + audits the reset.
 */
export async function adminResetTotp(
  userId: string,
  actor: AuditContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, totpConfirmedAt: true },
  });
  if (!user) return { ok: false, error: "User not found." };
  if (!user.totpConfirmedAt) {
    return { ok: false, error: "That user does not have 2FA enabled." };
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpSecretCiphertext: null,
        totpSecretNonce: null,
        totpSecretTag: null,
        totpConfirmedAt: null,
        totpBackupCodes: undefined,
        securityStamp: bumpStamp(),
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: "user.totp.admin_reset",
      entityType: "User",
      entityId: userId,
      before: { email: user.email, totpEnabled: true },
      after: { totpEnabled: false },
    });
  });
  return { ok: true };
}

type ChallengeVia = "totp" | "backup";

/**
 * Verify a login challenge code (TOTP or backup) for an ENROLLED user, given the
 * already-loaded user row. On a successful backup-code use, the consumed code is
 * persisted (marked used) so it can't be replayed. Returns which method matched.
 * Fails closed: a non-enrolled user, undecryptable secret, or wrong code -> false.
 */
async function verifyChallengeForUser(
  user: TotpUserRow,
  code: string,
  now: Date,
): Promise<{ ok: true; via: ChallengeVia } | { ok: false }> {
  if (!user.totpConfirmedAt) return { ok: false };
  const cleaned = (code ?? "").trim();
  if (!cleaned) return { ok: false };

  const secret = decryptSecretFor(user);
  if (secret && verifyTotp(secret, cleaned, now)) {
    return { ok: true, via: "totp" };
  }

  // Try a one-time backup code (consumed on success).
  const stored = parseBackupCodes(user.totpBackupCodes);
  const next = await consumeBackupCode(stored, cleaned);
  if (next) {
    await prisma.user.update({
      where: { id: user.id },
      data: { totpBackupCodes: next as unknown as object },
    });
    return { ok: true, via: "backup" };
  }
  return { ok: false };
}

/**
 * Verify a login 2FA challenge for a user id. Loads the user, re-verifies, and
 * (for backup codes) consumes the code. Audited so the security log shows every
 * 2FA pass/fail at login. Returns ok/why for the action to act on.
 */
export async function verifyLoginChallenge(
  userId: string,
  code: string,
  actor: AuditContext,
  now: Date = new Date(),
): Promise<{ ok: true; via: ChallengeVia } | { ok: false; locked?: boolean }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { ok: false };

  // Brute-force lockout (mirrors break-glass): a 6-digit login TOTP is narrow,
  // so an attacker who already has the user's primary password could grind the
  // second factor. While locked, reject WITHOUT checking the code; each failure
  // atomically increments the counter (correct under a concurrent guess burst,
  // unlike read-then-write) and trips a timed lock at TOTP_MAX_ATTEMPTS; a
  // successful verify clears it.
  if (isTotpLocked(user.totpLockedUntil, now)) {
    await writeAudit(prisma, {
      ...actor,
      action: "user.totp.login_locked",
      entityType: "User",
      entityId: userId,
    });
    return { ok: false, locked: true };
  }

  const result = await verifyChallengeForUser(user, code, now);

  if (result.ok) {
    // Good code — clear any accumulated failures / lock.
    if (user.totpFailedAttempts !== 0 || user.totpLockedUntil) {
      await prisma.user.update({
        where: { id: userId },
        data: { totpFailedAttempts: 0, totpLockedUntil: null },
      });
    }
  } else {
    const { totpFailedAttempts } = await prisma.user.update({
      where: { id: userId },
      data: { totpFailedAttempts: { increment: 1 } },
      select: { totpFailedAttempts: true },
    });
    const lockedUntil = totpLockUntil(totpFailedAttempts, now);
    if (lockedUntil) {
      await prisma.user.update({
        where: { id: userId },
        data: { totpLockedUntil: lockedUntil },
      });
    }
  }

  await writeAudit(prisma, {
    ...actor,
    action: result.ok ? "user.totp.login_verified" : "user.totp.login_failed",
    entityType: "User",
    entityId: userId,
    after: result.ok ? { via: result.via } : { ok: false },
  });
  return result;
}
