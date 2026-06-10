import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { bigintReplacer } from "@/lib/money";

/**
 * Audit trail. Writes go to the append-only AuditLog table (UPDATE/DELETE blocked
 * by a DB trigger). `withAudit` runs the mutation and its audit row in ONE
 * transaction, so they commit or roll back together.
 */

export type Tx = Prisma.TransactionClient;
type Db = typeof prisma | Tx;

export interface AuditContext {
  actorType?: "user" | "breakglass" | "system";
  actorId?: string | null;
  actorEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  viaBreakGlass?: boolean;
}

export interface AuditEvent extends AuditContext {
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** JSON-safe value (bigint -> string) for the Json columns. */
function jsonSafe(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value, bigintReplacer)) as Prisma.InputJsonValue;
}

export async function writeAudit(db: Db, event: AuditEvent): Promise<void> {
  await db.auditLog.create({
    data: {
      actorType: event.actorType ?? "system",
      actorId: event.actorId ?? null,
      actorEmail: event.actorEmail ?? null,
      action: event.action,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      before: jsonSafe(event.before),
      after: jsonSafe(event.after),
      ip: event.ip ?? null,
      userAgent: event.userAgent ?? null,
      viaBreakGlass: event.viaBreakGlass ?? false,
    },
  });
}

/**
 * Run a mutation and record an audit row atomically. The callback receives the
 * transaction client and returns the result plus the audited `after`/`entityId`.
 */
export async function withAudit<T>(
  event: Omit<AuditEvent, "after">,
  fn: (tx: Tx) => Promise<{ result: T; after?: unknown; entityId?: string }>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const { result, after, entityId } = await fn(tx);
    await writeAudit(tx, {
      ...event,
      entityId: entityId ?? event.entityId,
      after,
    });
    return result;
  });
}
