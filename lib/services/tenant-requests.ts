import { prisma } from "@/lib/db";
import type {
  TenantRequestStatus,
  TenantRequestType,
} from "@/lib/generated/prisma/enums";
import { writeAudit, type AuditContext, type Tx } from "@/lib/audit/audit";
import { notifyStaffCashPickup } from "@/lib/services/staff-alerts";

/**
 * Tenant requests (portal submissions): maintenance issues and "I'll pay cash
 * — please arrange a pickup". Operating records only — NEVER ledger entries.
 * Staff work the queue at /requests (portal.manage); a maintenance request
 * can be converted into a MaintenanceJob via the cross-module loose ref.
 */

const MAX_MESSAGE_LENGTH = 2000;

export type CreateRequestResult =
  | { ok: true; requestId: string }
  | { ok: false; error: string };

/** Tenant-side creation (the caller has already verified the portal session). */
export async function createTenantRequest(i: {
  tenantId: string;
  leaseId: string | null;
  type: TenantRequestType;
  message: string;
}): Promise<CreateRequestResult> {
  const message = i.message.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (i.type === "maintenance" && message.length === 0) {
    return { ok: false, error: "Describe the issue so staff know what to fix." };
  }

  // Cash pickups dedupe to one OPEN request (tapping the button twice must
  // not page staff twice). Maintenance requests are always NEW rows — a
  // second issue is a second work item, never an overwrite of the first.
  const existing =
    i.type === "cash_pickup"
      ? await prisma.tenantRequest.findFirst({
          where: { tenantId: i.tenantId, type: "cash_pickup", status: "open" },
        })
      : null;
  if (existing) {
    return { ok: true, requestId: existing.id }; // already waiting — don't re-alert staff
  }

  const request = await prisma.$transaction(async (tx) => {
    const row = await tx.tenantRequest.create({
      data: {
        tenantId: i.tenantId,
        leaseId: i.leaseId,
        type: i.type,
        message,
      },
    });
    await writeAudit(tx, {
      actorType: "system",
      action: "portal.request_created",
      entityType: "TenantRequest",
      entityId: row.id,
      after: { tenantId: i.tenantId, type: i.type },
    });
    return row;
  });

  // Pickup requests page staff immediately (email + SMS); best-effort.
  if (i.type === "cash_pickup") {
    const tenant = await prisma.tenant.findUnique({
      where: { id: i.tenantId },
      select: { firstName: true, lastName: true },
    });
    const lease = i.leaseId
      ? await prisma.lease.findUnique({
          where: { id: i.leaseId },
          include: { unit: { include: { property: true } } },
        })
      : null;
    try {
      await notifyStaffCashPickup({
        tenantName: tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : "A tenant",
        propertyName: lease?.unit.property.name ?? null,
        unitLabel: lease?.unit.unitNumber ?? null,
        message,
      });
    } catch (e) {
      console.error("[tenant-requests] cash-pickup alert failed:", e);
    }
  }

  return { ok: true, requestId: request.id };
}

/** Staff-side: status changes from the /requests queue. */
export async function updateTenantRequestStatus(i: {
  requestId: string;
  status: TenantRequestStatus;
  resolutionNote?: string | null;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const request = await prisma.tenantRequest.findUnique({
    where: { id: i.requestId },
  });
  if (!request) return { ok: false, error: "Request not found." };
  await prisma.$transaction(async (tx) => {
    await tx.tenantRequest.update({
      where: { id: request.id },
      data: {
        status: i.status,
        resolutionNote: i.resolutionNote?.trim() || null,
        handledBy: i.actor.actorId ?? null,
        handledAt: new Date(),
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "tenant_request.status_changed",
      entityType: "TenantRequest",
      entityId: request.id,
      before: { status: request.status },
      after: { status: i.status, type: request.type },
    });
  });
  return { ok: true };
}

/**
 * Convert a maintenance request into a MaintenanceJob (Maintenance module).
 * The job carries the tenant's description; the request links to it and moves
 * to in_progress so the queue shows where the work went.
 */
/**
 * Keep a tenant request in step with its linked maintenance job's lifecycle.
 * Runs INSIDE the maintenance job's transaction (so the request status and the
 * job status commit together). The link is the loose `maintenanceJobId` ref —
 * completing the job resolves the request; reopening it puts the request back
 * in progress. A declined request is never reopened/auto-resolved.
 */
export async function syncTenantRequestForJob(
  tx: Tx,
  i: { jobId: string; jobStatus: "completed" | "reopened"; actor: AuditContext },
): Promise<void> {
  const request = await tx.tenantRequest.findFirst({
    where: { maintenanceJobId: i.jobId },
  });
  if (!request || request.status === "declined") return;

  if (i.jobStatus === "completed") {
    if (request.status === "done") return;
    await tx.tenantRequest.update({
      where: { id: request.id },
      data: {
        status: "done",
        handledBy: i.actor.actorId ?? request.handledBy,
        handledAt: new Date(),
        resolutionNote: request.resolutionNote ?? "Resolved via the linked maintenance job.",
      },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "tenant_request.auto_resolved",
      entityType: "TenantRequest",
      entityId: request.id,
      after: { status: "done", maintenanceJobId: i.jobId },
    });
  } else {
    if (request.status !== "done") return;
    await tx.tenantRequest.update({
      where: { id: request.id },
      data: { status: "in_progress" },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "tenant_request.reopened_with_job",
      entityType: "TenantRequest",
      entityId: request.id,
      after: { status: "in_progress", maintenanceJobId: i.jobId },
    });
  }
}

export async function convertRequestToJob(i: {
  requestId: string;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const request = await prisma.tenantRequest.findUnique({
    where: { id: i.requestId },
    include: { tenant: { select: { firstName: true, lastName: true } } },
  });
  if (!request) return { ok: false, error: "Request not found." };
  if (request.type !== "maintenance") {
    return { ok: false, error: "Only maintenance requests convert to jobs." };
  }
  if (request.maintenanceJobId) {
    return { ok: false, error: "This request already has a job." };
  }
  const lease = request.leaseId
    ? await prisma.lease.findUnique({
        where: { id: request.leaseId },
        include: { unit: true },
      })
    : null;
  if (!lease) {
    return {
      ok: false,
      error: "The request isn't tied to a lease — create the job manually.",
    };
  }

  const tenantName = `${request.tenant.firstName} ${request.tenant.lastName}`.trim();
  await prisma.$transaction(async (tx) => {
    const job = await tx.maintenanceJob.create({
      data: {
        propertyId: lease.unit.propertyId,
        unitId: lease.unitId,
        title: `Tenant request — ${tenantName}`,
        details: request.message,
        status: "pending",
        createdBy: i.actor.actorId ?? null,
      },
    });
    await tx.tenantRequest.update({
      where: { id: request.id },
      data: {
        maintenanceJobId: job.id,
        status: "in_progress",
        handledBy: i.actor.actorId ?? null,
        handledAt: new Date(),
      },
    });
    // Carry the tenant's request photos onto the job so they show on the work
    // order (the loose tenantRequestId ref stays for provenance).
    await tx.uploadedDocument.updateMany({
      where: { tenantRequestId: request.id, maintenanceJobId: null },
      data: { maintenanceJobId: job.id },
    });
    await writeAudit(tx, {
      ...i.actor,
      action: "tenant_request.converted_to_job",
      entityType: "TenantRequest",
      entityId: request.id,
      after: { maintenanceJobId: job.id },
    });
  });
  return { ok: true };
}
