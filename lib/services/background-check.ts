import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { getBackgroundCheckProvider } from "@/lib/providers/background-check";
import type { BackgroundCheckDecision } from "@/lib/providers/background-check";
import type { BackgroundCheckStatus } from "@/lib/generated/prisma/enums";

/**
 * Tenant-screening / background checks for a rental application (module
 * "applications"). Operating records only — never ledger entries, never linked
 * to balances. Bridges Prisma ↔ the swappable provider seam
 * (lib/providers/background-check); the default provider simulates decisions.
 */

/** A provider decision is "terminal" when no further result is expected. */
function isTerminal(status: BackgroundCheckDecision): boolean {
  return status !== "pending";
}

export async function listBackgroundChecks(applicationId: string) {
  return prisma.backgroundCheck.findMany({
    where: { applicationId },
    orderBy: { createdAt: "desc" },
  });
}

/** Most recent check for an application, or null. */
export async function getLatestBackgroundCheck(applicationId: string) {
  return prisma.backgroundCheck.findFirst({
    where: { applicationId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Request a background check for an application via the configured provider.
 * Refuses to start a second one while a check is still pending (real providers
 * are paid, per-run). Audited. Returns the created check row.
 */
export async function requestBackgroundCheck(
  applicationId: string,
  actor: AuditContext,
) {
  await assertModuleEnabled("applications");

  const app = await prisma.rentalApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true },
  });
  if (!app) throw new Error("Application not found.");

  const pending = await prisma.backgroundCheck.findFirst({
    where: { applicationId, status: "pending" },
    select: { id: true },
  });
  if (pending) {
    throw new Error("A background check is already in progress for this applicant.");
  }

  const provider = getBackgroundCheckProvider();
  const result = await provider.request({
    candidate: {
      firstName: app.firstName,
      lastName: app.lastName,
      email: app.email,
      phone: app.phone,
    },
    reference: app.id,
  });

  const status = result.status as BackgroundCheckStatus;
  const completedAt = isTerminal(result.status) ? new Date() : null;

  return withAudit(
    {
      ...actor,
      action: "background_check.requested",
      entityType: "BackgroundCheck",
    },
    async (tx) => {
      const check = await tx.backgroundCheck.create({
        data: {
          applicationId,
          provider: provider.name,
          status,
          externalId: result.externalId,
          summary: result.summary,
          reportUrl: result.reportUrl,
          resultJson:
            result.raw === undefined ? undefined : (result.raw as object),
          requestedBy: actor.actorId ?? null,
          completedAt,
        },
      });
      return {
        result: check,
        entityId: check.id,
        after: {
          applicationId,
          provider: provider.name,
          status: check.status,
          externalId: check.externalId,
        },
      };
    },
  );
}

/** Cancel a still-pending check (e.g. abandoned async request). Audited. */
export async function cancelBackgroundCheck(
  id: string,
  actor: AuditContext,
): Promise<void> {
  await assertModuleEnabled("applications");
  const before = await prisma.backgroundCheck.findUnique({ where: { id } });
  if (!before) throw new Error("Background check not found.");
  if (before.status !== "pending") {
    throw new Error("Only a pending background check can be canceled.");
  }

  await withAudit(
    {
      ...actor,
      action: "background_check.canceled",
      entityType: "BackgroundCheck",
      entityId: id,
      before: { status: before.status },
    },
    async (tx) => {
      const updated = await tx.backgroundCheck.update({
        where: { id },
        data: { status: "canceled", completedAt: new Date() },
      });
      return { result: updated, after: { status: updated.status } };
    },
  );
}
