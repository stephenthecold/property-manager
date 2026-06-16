"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { createUploadedDocument } from "@/lib/services/documents";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import { parseMaintenancePriority } from "@/lib/maintenance/priority";
import type { FormState } from "@/lib/forms";

const ATTACH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ATTACH_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

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

export async function createJobAction(fd: FormData): Promise<void> {
  const { dbUser } = await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");

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
        },
      };
    },
  );
  revalidate(unitId);
}

export async function completeJobAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { dbUser } = await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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

  await withAudit(
    {
      ...(await auditActor()),
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
      // Mirror a real cost into the Financials expense log (cross-module seam).
      // The expense survives module toggles and job reopening — it is the
      // financial record of money actually spent.
      if (costCents != null && costCents > 0n) {
        await tx.propertyExpense.create({
          data: {
            propertyId: job.propertyId,
            unitId: job.unitId,
            category: "maintenance",
            amountCents: costCents,
            incurredOn: new Date(),
            description: `Maintenance: ${job.title}`,
            sourceType: "maintenance_job",
            sourceId: job.id,
            createdBy: dbUser.id,
          },
        });
      }
      return { result: updated, after: { status: "completed", costCents } };
    },
  );
  revalidate(job.unitId);
  revalidatePath("/financials");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function reopenJobAction(fd: FormData): Promise<void> {
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
  const id = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id } });
  if (!job || job.status !== "completed") return;

  await withAudit(
    {
      ...(await auditActor()),
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
      return { result: updated, after: { status: "pending" } };
    },
  );
  revalidate(job.unitId);
}

export async function deleteJobAction(fd: FormData): Promise<void> {
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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
}

/** Post a threaded progress note on a job (the ticket timeline). Append-only. */
export async function addJobUpdateAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  const { dbUser } = await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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

/** Attach a photo/invoice (image or PDF) to a maintenance job. */
export async function addJobAttachmentAction(
  _prev: FormState,
  fd: FormData,
): Promise<FormState> {
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
  const id = str(fd, "taskId");
  const task = await prisma.recurringTask.findUnique({ where: { id } });
  if (!task) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.task_done",
      entityType: "RecurringTask",
      entityId: task.id,
      before: { lastDoneOn: task.lastDoneOn },
    },
    async (tx) => {
      const updated = await tx.recurringTask.update({
        where: { id: task.id },
        data: { lastDoneOn: new Date() },
      });
      return { result: updated, after: { lastDoneOn: updated.lastDoneOn } };
    },
  );
  revalidate();
}

export async function removeTaskAction(fd: FormData): Promise<void> {
  await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
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
