"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";

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
          dueDate,
          notifyTenants,
          notifyDaysBefore,
          createdBy: dbUser.id,
        },
      });
      return {
        result: created,
        entityId: created.id,
        after: { title, unitId, dueDate, notifyTenants, notifyDaysBefore },
      };
    },
  );
  revalidate(unitId);
}

export async function completeJobAction(fd: FormData): Promise<void> {
  const { dbUser } = await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");
  const id = str(fd, "jobId");
  const job = await prisma.maintenanceJob.findUnique({ where: { id } });
  if (!job) throw new Error("Job not found.");
  if (job.status === "completed") return; // double-submit no-op

  const costRaw = str(fd, "cost");
  const costCents = costRaw ? toCents(costRaw) : null;
  if (costCents != null && costCents < 0n) throw new Error("Cost cannot be negative.");

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
