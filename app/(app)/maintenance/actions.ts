"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function revalidate(unitId?: string | null): void {
  revalidatePath("/maintenance");
  if (unitId) revalidatePath(`/units/${unitId}`);
}

export async function createJobAction(fd: FormData): Promise<void> {
  const { dbUser } = await requireCapability("maintenance.manage");
  await assertModuleEnabled("maintenance");

  const title = str(fd, "title");
  if (!title) throw new Error("Job title is required.");

  // Unit (if given) determines the property; otherwise a property is required.
  const unitId = str(fd, "unitId") || null;
  let propertyId = str(fd, "propertyId") || null;
  let tz = "UTC";
  if (unitId) {
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: { property: { select: { id: true, timezone: true } } },
    });
    if (!unit) throw new Error("Unit not found.");
    propertyId = unit.property.id;
    tz = unit.property.timezone;
  } else if (propertyId) {
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw new Error("Property not found.");
    tz = property.timezone;
  } else {
    throw new Error("Pick a unit or a property for the job.");
  }

  const dueRaw = str(fd, "dueDate");
  const dueDate = dueRaw ? parseDateOnlyInZone(dueRaw, tz) : null;
  if (dueRaw && !dueDate) throw new Error("Due date must be a valid date (YYYY-MM-DD).");

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
          createdBy: dbUser.id,
        },
      });
      return { result: created, entityId: created.id, after: { title, unitId, dueDate } };
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
  if (!propertyId || !title) throw new Error("Property and task title are required.");
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error("Property not found.");

  await withAudit(
    {
      ...(await auditActor()),
      action: "maintenance.task_created",
      entityType: "RecurringTask",
    },
    async (tx) => {
      const created = await tx.recurringTask.create({
        data: { propertyId, title, notes: str(fd, "notes") || null },
      });
      return { result: created, entityId: created.id, after: { propertyId, title } };
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
