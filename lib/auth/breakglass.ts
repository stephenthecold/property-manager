import { prisma } from "@/lib/db";
import { getAuthSettings, invalidateAuthSettingsCache } from "@/lib/auth/settings";
import {
  dummyVerify,
  hashPassword,
  randomToken,
  verifyPassword,
} from "@/lib/auth/crypto";
import { writeAudit } from "@/lib/audit/audit";

/**
 * Break-glass emergency access. Off by default; enabled only by the CLI, which
 * provisions a one-time random passphrase (argon2id-hashed at rest) and an
 * auto-expiry. Owner-scope only. Every attempt is audited; repeated failures lock.
 */

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const DEFAULT_TTL_HOURS = 72;

export interface BreakGlassUser {
  id: string;
  email: string;
  name?: string | null;
  role: "owner";
  viaBreakGlass: true;
}

function clientMeta(req?: Request): { ip: string | null; ua: string | null } {
  if (!req) return { ip: null, ua: null };
  const xff = req.headers.get("x-forwarded-for");
  return {
    ip: xff ? xff.split(",")[0]?.trim() ?? null : null,
    ua: req.headers.get("user-agent"),
  };
}

/** Authorize a break-glass login. Returns the first active owner, or null. */
export async function verifyBreakGlass(
  passphrase: string,
  req?: Request,
): Promise<BreakGlassUser | null> {
  const { ip, ua } = clientMeta(req);
  const audit = (action: string, ok: boolean) =>
    writeAudit(prisma, {
      actorType: "breakglass",
      action,
      entityType: "BreakGlassCredential",
      viaBreakGlass: true,
      ip,
      userAgent: ua,
      after: { ok },
    });

  const settings = await getAuthSettings();
  const cred = await prisma.breakGlassCredential.findUnique({
    where: { id: "singleton" },
  });

  // Constant-time-ish: always run a verify even when disabled / unprovisioned.
  if (!settings.breakGlassEnabled || !cred?.passwordHash) {
    await dummyVerify(passphrase);
    await audit("breakglass.login.denied", false);
    return null;
  }
  if (cred.lockedUntil && cred.lockedUntil > new Date()) {
    await dummyVerify(passphrase);
    await audit("breakglass.login.locked", false);
    return null;
  }

  const ok = await verifyPassword(cred.passwordHash, passphrase);
  if (!ok) {
    const attempts = cred.failedAttempts + 1;
    await prisma.breakGlassCredential.update({
      where: { id: "singleton" },
      data: {
        failedAttempts: attempts,
        lockedUntil:
          attempts >= MAX_ATTEMPTS
            ? new Date(Date.now() + LOCK_MINUTES * 60_000)
            : null,
      },
    });
    await audit("breakglass.login.failed", false);
    return null;
  }

  await prisma.breakGlassCredential.update({
    where: { id: "singleton" },
    data: { failedAttempts: 0, lockedUntil: null },
  });

  const owner = await prisma.user.findFirst({
    where: { role: "owner", isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) {
    await audit("breakglass.login.no-owner", false);
    return null;
  }

  await audit("breakglass.login.success", true);
  return {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    role: "owner",
    viaBreakGlass: true,
  };
}

/** CLI: provision (or rotate) a one-time passphrase and enable break-glass with an expiry. */
export async function issueBreakGlass(
  ttlHours = DEFAULT_TTL_HOURS,
): Promise<{ passphrase: string; expiresAt: Date }> {
  const passphrase = randomToken(32); // 256-bit (64 hex chars)
  const passwordHash = await hashPassword(passphrase);
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);

  // Credential + enable-flag + audit commit together: a crash mid-write must not
  // leave a stored hash with no expiry, or enabled in one table but not the other.
  await prisma.$transaction(async (tx) => {
    await tx.breakGlassCredential.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", passwordHash, failedAttempts: 0, rotatedAt: new Date() },
      update: { passwordHash, failedAttempts: 0, lockedUntil: null, rotatedAt: new Date() },
    });
    await tx.authSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", breakGlassEnabled: true, breakGlassExpiresAt: expiresAt },
      update: { breakGlassEnabled: true, breakGlassExpiresAt: expiresAt },
    });
    await writeAudit(tx, {
      actorType: "system",
      action: "breakglass.issued",
      entityType: "BreakGlassCredential",
      after: { expiresAt },
    });
  });
  invalidateAuthSettingsCache();
  return { passphrase, expiresAt };
}

/** CLI / auto-disable: turn break-glass off and clear the credential. */
export async function disableBreakGlass(reason = "manual"): Promise<void> {
  // Disable flag + credential clear + audit commit together: a crash between
  // them must not leave break-glass "off" while the password hash is still at
  // rest (a credential believed cleared but still present).
  await prisma.$transaction(async (tx) => {
    await tx.authSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", breakGlassEnabled: false, breakGlassExpiresAt: null },
      update: { breakGlassEnabled: false, breakGlassExpiresAt: null },
    });
    await tx.breakGlassCredential.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", passwordHash: null },
      update: { passwordHash: null, failedAttempts: 0, lockedUntil: null },
    });
    await writeAudit(tx, {
      actorType: "system",
      action: "breakglass.disabled",
      entityType: "BreakGlassCredential",
      after: { reason },
    });
  });
  invalidateAuthSettingsCache();
}
