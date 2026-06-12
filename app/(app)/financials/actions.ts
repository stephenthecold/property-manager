"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toCents } from "@/lib/money";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { withAudit } from "@/lib/audit/audit";
import { assertModuleEnabled } from "@/lib/services/app-settings";
import { parseDateOnlyInZone } from "@/lib/accounting/periods";
import type { ExpenseCategory } from "@/lib/generated/prisma/enums";

const CATEGORIES = ["utilities", "insurance", "maintenance", "taxes", "other"] as const;

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

export async function createExpenseAction(fd: FormData): Promise<void> {
  const { dbUser } = await requireCapability("financials.manage");
  await assertModuleEnabled("financials");

  const categoryRaw = str(fd, "category");
  if (!(CATEGORIES as readonly string[]).includes(categoryRaw)) {
    throw new Error("Choose an expense category.");
  }
  const category = categoryRaw as ExpenseCategory;

  const amountCents = toCents(str(fd, "amount"));
  if (amountCents <= 0n) throw new Error("Expense amount must be positive.");

  // Attribution: lease wins (derives unit+property), then unit (derives
  // property), else the selected property.
  const leaseId = str(fd, "leaseId") || null;
  const unitIdRaw = str(fd, "unitId") || null;
  const propertyIdRaw = str(fd, "propertyId") || null;

  let propertyId: string;
  let unitId: string | null = null;
  let buildingId: string | null = null;
  let resolvedLeaseId: string | null = null;

  if (leaseId) {
    const lease = await prisma.lease.findUnique({
      where: { id: leaseId },
      include: { unit: true },
    });
    if (!lease) throw new Error("Lease not found.");
    resolvedLeaseId = lease.id;
    unitId = lease.unitId;
    buildingId = lease.unit.buildingId;
    propertyId = lease.unit.propertyId;
  } else if (unitIdRaw) {
    const unit = await prisma.unit.findUnique({ where: { id: unitIdRaw } });
    if (!unit) throw new Error("Unit not found.");
    unitId = unit.id;
    buildingId = unit.buildingId;
    propertyId = unit.propertyId;
  } else if (propertyIdRaw) {
    propertyId = propertyIdRaw;
  } else {
    throw new Error("Pick a property, unit, or lease for the expense.");
  }

  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw new Error("Property not found.");

  const dateRaw = str(fd, "incurredOn");
  const incurredOn = dateRaw
    ? parseDateOnlyInZone(dateRaw, property.timezone)
    : new Date();
  if (dateRaw && !incurredOn) throw new Error("Date must be a valid date (YYYY-MM-DD).");

  await withAudit(
    {
      ...(await auditActor()),
      action: "financials.expense_added",
      entityType: "PropertyExpense",
      entityId: "(new)",
    },
    async (tx) => {
      const created = await tx.propertyExpense.create({
        data: {
          propertyId,
          buildingId,
          unitId,
          leaseId: resolvedLeaseId,
          category,
          amountCents,
          incurredOn: incurredOn!,
          description: str(fd, "description") || null,
          createdBy: dbUser.id,
        },
      });
      return {
        result: created,
        entityId: created.id,
        after: { propertyId, unitId, leaseId: resolvedLeaseId, category, amountCents },
      };
    },
  );

  revalidatePath("/financials");
  revalidatePath("/dashboard");
}

export async function deleteExpenseAction(fd: FormData): Promise<void> {
  await requireCapability("financials.manage");
  await assertModuleEnabled("financials");
  const id = str(fd, "expenseId");
  if (!id) throw new Error("Missing expense id.");
  const expense = await prisma.propertyExpense.findUnique({ where: { id } });
  if (!expense) return;

  await withAudit(
    {
      ...(await auditActor()),
      action: "financials.expense_deleted",
      entityType: "PropertyExpense",
      entityId: expense.id,
      before: {
        propertyId: expense.propertyId,
        unitId: expense.unitId,
        category: expense.category,
        amountCents: expense.amountCents,
        incurredOn: expense.incurredOn,
        description: expense.description,
      },
    },
    async (tx) => {
      await tx.propertyExpense.delete({ where: { id } });
      return { result: undefined };
    },
  );

  revalidatePath("/financials");
  revalidatePath("/dashboard");
}
