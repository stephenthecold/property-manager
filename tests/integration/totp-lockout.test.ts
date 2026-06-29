import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyLoginChallenge } from "@/lib/services/totp";
import { generateSecret, generateTotp, TOTP_MAX_ATTEMPTS } from "@/lib/auth/totp";
import { encryptSecret } from "@/lib/auth/crypto";

/**
 * Integration test (real Postgres): the login 2FA challenge must lock after a
 * capped number of wrong codes so the second factor can't be brute-forced.
 */

const P = `itest-2fa-${Math.random().toString(36).slice(2, 8)}`;
const userId = `${P}-user`;
const ACTOR = { actorType: "system" as const, actorId: null };
const SECRET = generateSecret();

beforeAll(async () => {
  const enc = encryptSecret(SECRET, `user:totpSecret:${userId}`);
  await prisma.user.create({
    data: {
      id: userId,
      email: `${P}@example.com`,
      role: "viewer",
      totpConfirmedAt: new Date(), // enrolled → the challenge path runs
      totpSecretCiphertext: enc.ciphertext,
      totpSecretNonce: enc.nonce,
      totpSecretTag: enc.tag,
    },
  });
});

afterAll(async () => {
  // AuditLog is append-only (the verify writes login_failed/locked/verified
  // rows) — leave them, like the other integration tests do.
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("2FA login-challenge brute-force lockout", () => {
  it("locks after the cap, blocks even a valid code, and a good code clears it", async () => {
    const now = new Date();

    // Wrong codes up to the cap: each fails; none is reported locked (the
    // cap-th attempt trips the lock but is itself just a failed verify).
    for (let i = 0; i < TOTP_MAX_ATTEMPTS; i++) {
      const r = await verifyLoginChallenge(userId, "000000", ACTOR, now);
      expect(r.ok).toBe(false);
      expect((r as { locked?: boolean }).locked ?? false).toBe(false);
    }
    const capped = await prisma.user.findUnique({ where: { id: userId } });
    expect(capped?.totpFailedAttempts).toBe(TOTP_MAX_ATTEMPTS);
    expect(capped?.totpLockedUntil).toBeTruthy();
    expect(capped!.totpLockedUntil!.getTime()).toBeGreaterThan(now.getTime());

    // Locked: even a CURRENTLY VALID code is rejected without being checked.
    const validCode = generateTotp(SECRET, now);
    const blocked = await verifyLoginChallenge(userId, validCode, ACTOR, now);
    expect(blocked).toEqual({ ok: false, locked: true });

    // Cooldown elapses (simulated): a valid code now succeeds AND resets state.
    await prisma.user.update({
      where: { id: userId },
      data: { totpLockedUntil: null },
    });
    const ok = await verifyLoginChallenge(userId, validCode, ACTOR, now);
    expect(ok.ok).toBe(true);
    const cleared = await prisma.user.findUnique({ where: { id: userId } });
    expect(cleared?.totpFailedAttempts).toBe(0);
    expect(cleared?.totpLockedUntil).toBeNull();
  });
});
