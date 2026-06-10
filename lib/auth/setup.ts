import "server-only";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { constantTimeEqual } from "@/lib/auth/crypto";
import { writeAudit } from "@/lib/audit/audit";

/** First-run setup is available only while no users exist. */
export async function needsSetup(): Promise<boolean> {
  const count = await prisma.user.count();
  return count === 0;
}

/**
 * /setup is gated by BOTH a zero-users check AND the CLI bootstrap token, so a
 * wiped User table cannot silently re-expose unauthenticated owner creation.
 */
export function verifyBootstrapToken(token: string | undefined | null): boolean {
  const expected = getEnv().SETUP_BOOTSTRAP_TOKEN;
  if (!expected || !token) return false;
  return constantTimeEqual(token, expected);
}

/**
 * Create the first owner. A transaction-scoped advisory lock + re-check prevents
 * two concurrent setups from each creating an owner (TOCTOU).
 */
export async function createFirstOwner(input: {
  email: string;
  name: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(918273645)`;
    const count = await tx.user.count();
    if (count > 0) {
      throw new Error("Setup already completed.");
    }
    const user = await tx.user.create({
      data: { email, name: input.name.trim(), role: "owner", isActive: true },
    });
    await writeAudit(tx, {
      actorType: "system",
      action: "setup.first_owner_created",
      entityType: "User",
      entityId: user.id,
      after: { email, role: "owner" },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { id: user.id };
  });
}
