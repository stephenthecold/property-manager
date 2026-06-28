"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireModuleCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { createUploadedDocument } from "@/lib/services/documents";
import { syncTenantRequestForJob } from "@/lib/services/tenant-requests";
import { isActiveVendor } from "@/lib/services/vendors";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import { parseMaintenancePriority } from "@/lib/maintenance/priority";
import { monthKeyFor } from "@/lib/maintenance/recurring";
import {
  isOpenStatus,
  parseMaintenanceStatus,
} from "@/lib/maintenance/status";
import { getFormString as str, type FormState } from "@/lib/forms";

const ATTACH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ATTACH_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

/**
 * Validation failures land back on the maintenance page as a banner instead
 * of being thrown — a thrown server-action error renders as the opaque
 * production digest page.
 */
function fail(message: string): never {
  redirect(`/maintenance?error=${encodeURIComponent(message)}`);
}

/**
 * Shared tenant-notification fields on jobs and recurring tasks:
 * an optional schedule day, the SMS opt-in, and the lead time (0-14 days).
 */
function parseNotifyFields(fd: FormData): {
  notifyTenants: boolean;
  notifyDaysBefore: number;
} {
  const notifyTenants = fd.get("notifyTenants") != null;
  const daysRaw = str(fd, "notifyDaysBefore");
  let notifyDaysBefore = 2;
  if (daysRaw !== "") {
    const n = Number(daysRaw);
    if (!Number.isInteger(n) || n < 0 || n > 14) {
      fail("Days before must be a whole number from 0 to 14.");
    }
    notifyDaysBefore = n;
  }
  return { notifyTenants, notifyDaysBefore };
}

/** Optional day-of-month (1-31; clamped to short months downstream). */
function parseDueDay(fd: FormData): number | null {
  const raw = str(fd, "dueDay");
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    fail("Day of month must be a whole number from 1 to 31.");
  }
  return n;
}

function revalidate(unitId?: string | null): void {
  revalidatePath("/maintenance");
  if (unitId) revalidatePath(`/units/${unitId}`);
}

/**
 * Validate an optional asset link for a job: the asset must exist and belong to
 * the job's property (and, when the job is scoped to a unit, to that unit OR be
 * a property-wide asset). The picker only offers in-scope assets, but never
 * trust it for a write. Returns the validated id (or null), or an error string.
 */
async function validateJobAsset(
  assetId: string | null,
  propertyId: string,
  unitId: string | null,
): Promise<{ assetId: string | null } | { error: string }> {
  if (!assetId) return { assetId: null };
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { propertyId: true, unitId: true },
  });
  if (!asset) return { error: "Selected asset not found." };
  if (asset.propertyId !== propertyId) {
    return { error: "That asset is not in the job's property." };
  }
  // A unit-scoped asset can only attach to a job for that same unit; a
  // property-wide asset (asset.unitId === null) is allowed on any job here.
  if (asset.unitId && asset.unitId !== unitId) {
    return { error: "That asset belongs to a different unit." };
  }
  return { assetId };
}

export async function createJobAction(fd: FormData): Promise<void> {
  const { dbUser } = await requireModuleCapability("maintenance.manage", "maintenance");

  const title = str(fd, "title");
  if (!title) fail("Job title is required.");

  // Unit (if given) determines the property; otherwise a property is required.
  const unitId = str(fd, "unitId") || null;
  let propertyId = str(fd, "propertyId") || null;
  let tz = "UTC";
  if (unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: { property: { select: { id: true, timezone: true } } },
    });
    if (!unit) fail("Unit not found.");
    propertyId = unit.property.id;
    tz = unit.property.timezone;
  } else if (propertyId) {
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) fail("Property not found.");
    tz = property.timezone;
  } else {
    fail("Pick a unit or a property for the job.");
  }

  const dueRaw = str(fd, "dueDate");
  const dueDate = dueRaw ? parseDateOnlyInZone(dueRaw, tz) : null;
  if (dueRaw && !dueDate) fail("Due date must be a valid date (YYYY-MM-DD).");

  const { notifyTenants, notifyDaysBefore } = parseNotifyFields(fd);
  if (notifyTenants && !dueDate) {
    fail("Tenant SMS notifications need a due date.");
  }

  // Optional vendor assignment (module "vendors"). Validate it's a real active
  // vendor; the picker only offers active ones.
  const vendorId = str(fd, "vendorId") || null;
  if (vendorId && !(await isActiveVendor(vendorId))) {
    fail("Selected vendor not found.");
  }

  // Optional asset link — must be in the job's property/unit scope.
  const assetCheck = await validateJobAsset(str(fd, "assetId") || null, propertyId!, unitId);
  if ("error" in assetCheck) fail(assetCheck.error);
  const assetId = assetCheck.assetId;

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.job_created",
      entityType: "MaintenanceJob",
    },
    async (tx) => {
      const created = await tx.maintenanceJob.create({
        data: {
          propertyId: propertyId!,
          unitId,
          title,
          details: str(fd, "details") || null,
          priority: parseMaintenancePriority(str(fd, "priority")),
          dueDate,
          notifyTenants,
          notifyDaysBefore,
          vendorId,
          assetId,
          createdBy: dbUser.id,
        },
      });
      return {
        result: created,
        entityId: created.id,
        after: {
          title,
          unitId,
          priority: created.priority,
          dueDate,
          notifyTenants,
          notifyDaysBefore,
          assetId,
        },
      };
    },
  );
  revalidate(unitId);
  // A job linked to an asset at creation shows up in the asset's job list.
  if (assetId) revalidatePath("/assets");
}

export async function completeJobAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { dbUser } = await requireModuleCapability("maintenance.manage", "maintenance");
  const id = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id } });
  if (!job) return { error: "Job not found." };
  if (job.status === "completed") return { ok: true }; // double-submit no-op

  const costRaw = str(fd, "cost");
  let costCents: bigint | null = null;
  if (costRaw) {
    try {
      costCents = toCents(costRaw);
    } catch {
      return { error: "Cost must be a valid amount (e.g. 150.00)." };
    }
  }
  if (costCents != null && costCents < 0n) {
    return { error: "Cost cannot be negative." };
  }

  const actor = await auditActor();
  await withAudit(
    {
      ...actor,
      action: "maintenance.job_completed",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { status: job.status },
    },
    async (tx) => {
      const updated = await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { status: "completed", completedAt: new Date(), costCents },
      });
      // Cohesion: resolve the originating tenant request, if this job came from
      // one (same transaction, so request + job statuses commit together).
      await syncTenantRequestForJob(tx, {
        jobId: job.id,
        jobStatus: "completed",
        actor,
      });
      // Mirror a real cost into the Financials expense log (cross-module seam).
      // The expense survives module toggles and job reopening — it is the
      // financial record of money actually spent. Idempotent: exactly one
      // expense per job (partial unique on sourceType+sourceId), so re-completing
      // after a reopen UPDATES the mirror instead of stacking a duplicate that
      // would double-count Financials.
      if (costCents != null && costCents > 0n) {
        const expenseData = {
          propertyId: job.propertyId,
          unitId: job.unitId,
          category: "maintenance" as const,
          amountCents: costCents,
          incurredOn: new Date(),
          description: `Maintenance: ${job.title}`,
          vendorId: job.vendorId, // carry the job's vendor onto the expense
        };
        const existing = await tx.propertyExpense.findFirst({
          where: { sourceType: "maintenance_job", sourceId: job.id },
          select: { id: true },
        });
        if (existing) {
          // Refresh the cost/date/vendor but PRESERVE createdBy (who first
          // logged the expense) — a later reopen→re-complete shouldn't
          // re-attribute it to the re-completer.
          await tx.propertyExpense.update({
            where: { id: existing.id },
            data: expenseData,
          });
        } else {
          await tx.propertyExpense.create({
            data: {
              ...expenseData,
              sourceType: "maintenance_job",
              sourceId: job.id,
              createdBy: dbUser.id,
            },
          });
        }
      }
      return { result: updated, after: { status: "completed", costCents } };
    },
  );
  revalidate(job.unitId);
  revalidatePath("/financials");
  revalidatePath("/dashboard");
  revalidatePath("/requests");
  return { ok: true };
}

export async function reopenJobAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const id = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id } });
  if (!job || job.status !== "completed") return;

  const actor = await auditActor();
  await withAudit(
    {
      ...actor,
      action: "maintenance.job_reopened",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { status: job.status, costCents: job.costCents },
    },
    async (tx) => {
      const updated = await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { status: "pending", completedAt: null },
      });
      // Cohesion: a reopened job puts its originating request back in progress.
      await syncTenantRequestForJob(tx, {
        jobId: job.id,
        jobStatus: "reopened",
        actor,
      });
      return { result: updated, after: { status: "pending" } };
    },
  );
  revalidate(job.unitId);
  revalidatePath("/requests");
}

export async function deleteJobAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const id = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id } });
  if (!job) return;
  if (job.status === "completed") {
    throw new Error("Completed jobs are history — reopen it first if it was a mistake.");
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.job_deleted",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { title: job.title, unitId: job.unitId, status: job.status },
    },
    async (tx) => {
      await tx.maintenanceJob.delete({ where: { id } });
      return { result: undefined };
    },
  );
  revalidate(job.unitId);
  // If the job was linked to an asset, refresh the asset registry's job list.
  if (job.assetId) revalidatePath("/assets");
}

/** Post a threaded progress note on a job (the ticket timeline). Append-only. */
export async function addJobUpdateAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { dbUser } = await requireModuleCapability("maintenance.manage", "maintenance");
  const jobId = str(fd, "jobId");
  const note = str(fd, "note");
  if (!note) return { error: "An update note is required." };
  const job = await prisma.maintenanceJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: "Job not found." };

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.update_added",
      entityType: "MaintenanceJob",
      entityId: job.id,
    },
    async (tx) => {
      const update = await tx.maintenanceUpdate.create({
        data: { jobId: job.id, note, createdBy: dbUser.id },
      });
      // Touch the job so its updatedAt reflects the latest activity.
      await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { updatedAt: new Date() },
      });
      return { result: update, after: { jobId: job.id } };
    },
  );
  revalidate(job.unitId);
  return { ok: true };
}

/** Change a job's triage priority (audited). No-op when unchanged. */
export async function setJobPriorityAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const jobId = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: "Job not found." };
  const priority = parseMaintenancePriority(str(fd, "priority"));
  if (priority === job.priority) return { ok: true }; // no-op resubmit

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.priority_changed",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { priority: job.priority },
    },
    async (tx) => {
      const updated = await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { priority },
      });
      return { result: updated, after: { priority } };
    },
  );
  revalidate(job.unitId);
  return { ok: true };
}

/**
 * Move a job between OPEN lifecycle states (pending / assigned / in_progress /
 * on_hold) or to `canceled`. Completion + reopen stay in their own actions so
 * the costCents -> PropertyExpense money flow is untouched; this action refuses
 * to set or leave `completed`. Audited; no-op when unchanged.
 */
export async function setJobStatusAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const jobId = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: "Job not found." };

  const status = parseMaintenanceStatus(str(fd, "status"));
  // Only open states or `canceled` are reachable here.
  if (status == null || !(isOpenStatus(status) || status === "canceled")) {
    return { error: "Pick a valid status." };
  }
  // Completed jobs carry a cost + expense record; route those through reopen.
  if (job.status === "completed") {
    return { error: "Reopen the job before changing its status." };
  }
  if (status === job.status) return { ok: true }; // no-op resubmit

  const actor = await auditActor();
  await withAudit(
    {
      ...actor,
      action: "maintenance.status_changed",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { status: job.status },
    },
    async (tx) => {
      const updated = await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { status },
      });
      // Cohesion: cancelling a job resolves its originating tenant request the
      // same way completion does (it's no longer open work).
      if (status === "canceled") {
        await syncTenantRequestForJob(tx, {
          jobId: job.id,
          jobStatus: "completed",
          actor,
        });
      }
      return { result: updated, after: { status } };
    },
  );
  revalidate(job.unitId);
  revalidatePath("/requests");
  return { ok: true };
}

/**
 * Assign (or clear) the staff member responsible for a job. The user id is a
 * loose ref — validated against active staff Users. Audited; no-op unchanged.
 */
export async function assignJobAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const jobId = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: "Job not found." };

  const assignedToUserId = str(fd, "assignedToUserId") || null;
  if (assignedToUserId) {
    const user = await prisma.user.findFirst({
      where: { id: assignedToUserId, isActive: true },
      select: { id: true },
    });
    if (!user) return { error: "Pick an active staff member." };
  }
  if (assignedToUserId === job.assignedToUserId) return { ok: true }; // no-op

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.assignee_changed",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { assignedToUserId: job.assignedToUserId },
    },
    async (tx) => {
      const updated = await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { assignedToUserId },
      });
      return { result: updated, after: { assignedToUserId } };
    },
  );
  revalidate(job.unitId);
  return { ok: true };
}

/**
 * Link (or clear) the registered Asset a job is about. Validated against the
 * job's own property/unit so a job can only point at an in-scope asset. Audited;
 * no-op when unchanged.
 */
export async function setJobAssetAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const jobId = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: "Job not found." };

  const check = await validateJobAsset(
    str(fd, "assetId") || null,
    job.propertyId,
    job.unitId,
  );
  if ("error" in check) return { error: check.error };
  const assetId = check.assetId;
  if (assetId === job.assetId) return { ok: true }; // no-op resubmit

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.asset_changed",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { assetId: job.assetId },
    },
    async (tx) => {
      const updated = await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { assetId },
      });
      return { result: updated, after: { assetId } };
    },
  );
  revalidate(job.unitId);
  revalidatePath("/assets");
  return { ok: true };
}

/**
 * Reopen a canceled job back to `pending` (plain-form variant for the row
 * button). Completed jobs go through reopenJobAction instead — that path also
 * clears completedAt. Like reopen, this restores the originating tenant request
 * to in-progress, since cancelling resolved it (mirrors reopenJobAction).
 */
export async function uncancelJobAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const id = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id } });
  if (!job || job.status !== "canceled") return;

  const actor = await auditActor();
  await withAudit(
    {
      ...actor,
      action: "maintenance.status_changed",
      entityType: "MaintenanceJob",
      entityId: job.id,
      before: { status: job.status },
    },
    async (tx) => {
      const updated = await tx.maintenanceJob.update({
        where: { id: job.id },
        data: { status: "pending" },
      });
      await syncTenantRequestForJob(tx, {
        jobId: job.id,
        jobStatus: "reopened",
        actor,
      });
      return { result: updated, after: { status: "pending" } };
    },
  );
  revalidate(job.unitId);
  revalidatePath("/requests");
}

/** Attach a photo/invoice (image or PDF) to a maintenance job. */
export async function addJobAttachmentAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const jobId = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id: jobId } });
  if (!job) return { error: "Job not found." };

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to attach." };
  }
  if (!ATTACH_TYPES.has(file.type)) {
    return { error: "Attachments must be an image (PNG/JPEG/WebP/HEIC) or a PDF." };
  }
  if (file.size > ATTACH_MAX_BYTES) {
    return { error: "Attachment too large (max 10 MB)." };
  }

  try {
    await createUploadedDocument({
      body: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || "attachment",
      contentType: file.type,
      uploadType: "other",
      maintenanceJobId: job.id,
      notes: `Maintenance attachment: ${job.title}`,
      actor: await auditActor(),
    });
  } catch (e) {
    console.error("[maintenance] attachment upload failed:", e);
    return {
      error:
        e instanceof Error && /storage is not configured/i.test(e.message)
          ? "File storage is not configured — attachments are unavailable."
          : "Upload failed — check the server log (storage permissions are the usual suspect).",
    };
  }
  revalidate(job.unitId);
  return { ok: true };
}

export async function createTaskAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const propertyId = str(fd, "propertyId");
  const title = str(fd, "title");
  if (!propertyId || !title) fail("Property and task title are required.");
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) fail("Property not found.");

  const dueDay = parseDueDay(fd);
  const { notifyTenants, notifyDaysBefore } = parseNotifyFields(fd);
  if (notifyTenants && dueDay == null) {
    fail("Tenant SMS notifications need a day of month.");
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.task_created",
      entityType: "RecurringTask",
    },
    async (tx) => {
      const created = await tx.recurringTask.create({
        data: {
          propertyId,
          title,
          notes: str(fd, "notes") || null,
          dueDay,
          notifyTenants,
          notifyDaysBefore,
        },
      });
      return {
        result: created,
        entityId: created.id,
        after: { propertyId, title, dueDay, notifyTenants, notifyDaysBefore },
      };
    },
  );
  revalidate();
}

/** Change an existing task's monthly schedule / tenant-notification settings. */
export async function editTaskScheduleAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const id = str(fd, "taskId");
  const task = await prisma.recurringTask.findUnique({ where: { id } });
  if (!task) fail("Task not found.");

  const dueDay = parseDueDay(fd);
  const { notifyTenants, notifyDaysBefore } = parseNotifyFields(fd);
  if (notifyTenants && dueDay == null) {
    fail("Tenant SMS notifications need a day of month.");
  }
  if (
    task.dueDay === dueDay &&
    task.notifyTenants === notifyTenants &&
    task.notifyDaysBefore === notifyDaysBefore
  ) {
    return; // no-op resubmit
  }

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.task_schedule_updated",
      entityType: "RecurringTask",
      entityId: task.id,
      before: {
        dueDay: task.dueDay,
        notifyTenants: task.notifyTenants,
        notifyDaysBefore: task.notifyDaysBefore,
      },
    },
    async (tx) => {
      const updated = await tx.recurringTask.update({
        where: { id: task.id },
        data: { dueDay, notifyTenants, notifyDaysBefore },
      });
      return {
        result: updated,
        after: { dueDay, notifyTenants, notifyDaysBefore },
      };
    },
  );
  revalidate();
}

export async function markTaskDoneAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const id = str(fd, "taskId");
  const task = await prisma.recurringTask.findUnique({
    where: { id },
    include: { property: { select: { timezone: true } } },
  });
  if (!task) return;

  const actor = await auditActor();
  // The completion belongs to the property-timezone civil month — the same key
  // the maintenance page uses for its "done this month" indicator.
  const doneOn = new Date();
  const periodKey = monthKeyFor(doneOn, task.property.timezone);

  await withAudit(
    {
      ...actor,
      action: "maintenance.task_done",
      entityType: "RecurringTask",
      entityId: task.id,
      before: { lastDoneOn: task.lastDoneOn },
    },
    async (tx) => {
      const updated = await tx.recurringTask.update({
        where: { id: task.id },
        data: { lastDoneOn: doneOn },
      });
      // Log the per-occurrence execution. Re-marking the same month updates the
      // existing row (one record per task per month). Operating record only —
      // it never touches tenant balances.
      await tx.recurringTaskExecution.upsert({
        where: { taskId_periodKey: { taskId: task.id, periodKey } },
        create: {
          taskId: task.id,
          periodKey,
          doneOn,
          doneByUserId: actor.actorId,
        },
        update: { doneOn, doneByUserId: actor.actorId },
      });
      return {
        result: updated,
        after: { lastDoneOn: updated.lastDoneOn, periodKey },
      };
    },
  );
  revalidate();
}

export async function removeTaskAction(fd: FormData): Promise<void> {
  await requireModuleCapability("maintenance.manage", "maintenance");
  const id = str(fd, "taskId");
  const task = await prisma.recurringTask.findUnique({ where: { id } });
  if (!task) return;

  // Deactivate rather than delete — the history (audit + lastDoneOn) is kept.
  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.task_removed",
      entityType: "RecurringTask",
      entityId: task.id,
      before: { title: task.title, active: task.active },
    },
    async (tx) => {
      const updated = await tx.recurringTask.update({
        where: { id: task.id },
        data: { active: false },
      });
      return { result: updated, after: { active: false } };
    },
  );
  revalidate();
}
