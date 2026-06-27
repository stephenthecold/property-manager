import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import type { Tx } from "@/lib/audit/audit";
import type { TurnoverChecklistStatus } from "@/lib/generated/prisma/enums";
import {
  DEFAULT_TURNOVER_ITEMS,
  deriveTurnoverStatus,
  isTurnoverOpen,
} from "@/lib/maintenance/turnover-status";

/**
 * Turnover / make-ready checklist service (module "maintenance"). A checklist is
 * an OPERATING record (rent-ready prep between tenancies) — it never touches the
 * ledger or tenant balances. Every mutation is audited; mirrors
 * lib/services/assets.ts (capability + module gating live in the calling server
 * actions, so this stays importable by the worker/CLI).
 */

export interface ChecklistWithItems {
  id: string;
  unitId: string;
  leaseId: string | null;
  status: TurnoverChecklistStatus;
  title: string | null;
  notes: string | null;
  startedOn: Date | null;
  readyOn: Date | null;
  createdAt: Date;
  items: {
    id: string;
    label: string;
    area: string | null;
    done: boolean;
    notes: string | null;
    assignedToUserId: string | null;
    orderIndex: number;
    doneAt: Date | null;
  }[];
}

/** All checklists for a unit, newest first, each with its ordered items. */
export async function listTurnoverChecklistsForUnit(
  unitId: string,
): Promise<ChecklistWithItems[]> {
  return prisma.turnoverChecklist.findMany({
    where: { unitId },
    orderBy: { createdAt: "desc" },
    include: {
      items: {
        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          label: true,
          area: true,
          done: true,
          notes: true,
          assignedToUserId: true,
          orderIndex: true,
          doneAt: true,
        },
      },
    },
  });
}

/**
 * Create a make-ready checklist for a unit, seeding the templated default items
 * (staff edit/add freely afterwards). Optionally references the ending lease.
 * Refuses to start a second OPEN checklist on the same unit — there is at most
 * one active turnover at a time.
 */
export async function createTurnoverChecklist(input: {
  unitId: string;
  leaseId: string | null;
  title: string | null;
  actor: AuditContext;
}): Promise<{ id: string } | { error: string }> {
  const unit = await prisma.unit.findUnique({
    where: { id: input.unitId },
    select: { id: true },
  });
  if (!unit) return { error: "Unit not found." };

  if (input.leaseId) {
    const lease = await prisma.lease.findUnique({
      where: { id: input.leaseId },
      select: { unitId: true },
    });
    if (!lease) return { error: "Lease not found." };
    if (lease.unitId !== input.unitId) {
      return { error: "That lease is not for this unit." };
    }
  }

  // At most one active (non-ready) turnover per unit.
  const existingOpen = await prisma.turnoverChecklist.findFirst({
    where: { unitId: input.unitId, status: { in: ["open", "in_progress"] } },
    select: { id: true },
  });
  if (existingOpen) {
    return { error: "This unit already has an active turnover checklist." };
  }

  const created = await withAudit(
    {
      ...input.actor,
      action: "turnover.checklist_created",
      entityType: "TurnoverChecklist",
      entityId: "(new)",
    },
    async (tx) => {
      const row = await tx.turnoverChecklist.create({
        data: {
          unitId: input.unitId,
          leaseId: input.leaseId,
          title: input.title,
          createdBy: input.actor.actorId ?? null,
          items: {
            create: DEFAULT_TURNOVER_ITEMS.map((it, i) => ({
              label: it.label,
              area: it.area,
              orderIndex: i,
              createdBy: input.actor.actorId ?? null,
            })),
          },
        },
      });
      return {
        result: row,
        entityId: row.id,
        after: {
          unitId: input.unitId,
          leaseId: input.leaseId,
          seededItems: DEFAULT_TURNOVER_ITEMS.length,
        },
      };
    },
  );
  return { id: created.id };
}

/** Add a custom item to the end of a checklist. */
export async function addTurnoverItem(input: {
  checklistId: string;
  label: string;
  area: string | null;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Item label is required." };
  const checklist = await prisma.turnoverChecklist.findUnique({
    where: { id: input.checklistId },
    select: { id: true },
  });
  if (!checklist) return { ok: false, error: "Checklist not found." };

  const last = await prisma.turnoverChecklistItem.findFirst({
    where: { checklistId: input.checklistId },
    orderBy: { orderIndex: "desc" },
    select: { orderIndex: true },
  });
  const nextIndex = (last?.orderIndex ?? -1) + 1;

  await withAudit(
    {
      ...input.actor,
      action: "turnover.item_added",
      entityType: "TurnoverChecklist",
      entityId: input.checklistId,
    },
    async (tx) => {
      const item = await tx.turnoverChecklistItem.create({
        data: {
          checklistId: input.checklistId,
          label,
          area: input.area,
          orderIndex: nextIndex,
          createdBy: input.actor.actorId ?? null,
        },
      });
      await touchChecklist(tx, input.checklistId);
      return { result: item, after: { label, area: input.area } };
    },
  );
  return { ok: true };
}

/**
 * Edit an item's text fields (label / area / notes / assignee). The done toggle
 * has its own entrypoint (toggleTurnoverItemDone) so its lifecycle side-effects
 * are explicit. `assignedToUserId` is validated against active staff (loose ref).
 */
export async function updateTurnoverItem(input: {
  itemId: string;
  label: string;
  area: string | null;
  notes: string | null;
  assignedToUserId: string | null;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const label = input.label.trim();
  if (!label) return { ok: false, error: "Item label is required." };
  const item = await prisma.turnoverChecklistItem.findUnique({
    where: { id: input.itemId },
    select: { id: true, checklistId: true, label: true, area: true, notes: true, assignedToUserId: true },
  });
  if (!item) return { ok: false, error: "Item not found." };

  if (input.assignedToUserId) {
    const user = await prisma.user.findFirst({
      where: { id: input.assignedToUserId, isActive: true },
      select: { id: true },
    });
    if (!user) return { ok: false, error: "Pick an active staff member." };
  }

  await withAudit(
    {
      ...input.actor,
      action: "turnover.item_updated",
      entityType: "TurnoverChecklistItem",
      entityId: item.id,
      before: {
        label: item.label,
        area: item.area,
        notes: item.notes,
        assignedToUserId: item.assignedToUserId,
      },
    },
    async (tx) => {
      const updated = await tx.turnoverChecklistItem.update({
        where: { id: item.id },
        data: {
          label,
          area: input.area,
          notes: input.notes,
          assignedToUserId: input.assignedToUserId,
        },
      });
      await touchChecklist(tx, item.checklistId);
      return {
        result: updated,
        after: { label, area: input.area, notes: input.notes, assignedToUserId: input.assignedToUserId },
      };
    },
  );
  return { ok: true };
}

/**
 * Check / uncheck an item. Stamps doneAt and (when the checklist is still OPEN,
 * never overriding a manual `ready`) advances the checklist status from the
 * resulting item progress — open -> in_progress -> ready — so the lifecycle
 * tracks the work without staff babysitting it.
 */
export async function toggleTurnoverItemDone(input: {
  itemId: string;
  done: boolean;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const item = await prisma.turnoverChecklistItem.findUnique({
    where: { id: input.itemId },
    select: { id: true, checklistId: true, done: true },
  });
  if (!item) return { ok: false, error: "Item not found." };
  if (item.done === input.done) return { ok: true }; // no-op resubmit

  await withAudit(
    {
      ...input.actor,
      action: input.done ? "turnover.item_done" : "turnover.item_undone",
      entityType: "TurnoverChecklistItem",
      entityId: item.id,
      before: { done: item.done },
    },
    async (tx) => {
      await tx.turnoverChecklistItem.update({
        where: { id: item.id },
        data: { done: input.done, doneAt: input.done ? new Date() : null },
      });
      await syncChecklistFromItems(tx, item.checklistId);
      return { result: undefined, after: { done: input.done } };
    },
  );
  return { ok: true };
}

/** Remove a single item from a checklist. */
export async function deleteTurnoverItem(input: {
  itemId: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const item = await prisma.turnoverChecklistItem.findUnique({
    where: { id: input.itemId },
    select: { id: true, checklistId: true, label: true },
  });
  if (!item) return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "turnover.item_deleted",
      entityType: "TurnoverChecklistItem",
      entityId: item.id,
      before: { label: item.label },
    },
    async (tx) => {
      await tx.turnoverChecklistItem.delete({ where: { id: item.id } });
      await syncChecklistFromItems(tx, item.checklistId);
      return { result: undefined };
    },
  );
  return { ok: true };
}

/**
 * Set the checklist status by hand (open / in_progress / ready). Stamps
 * startedOn the first time it leaves `open`, and readyOn when it reaches `ready`
 * (cleared if reopened). Audited; no-op when unchanged.
 */
export async function setTurnoverStatus(input: {
  checklistId: string;
  status: TurnoverChecklistStatus;
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const checklist = await prisma.turnoverChecklist.findUnique({
    where: { id: input.checklistId },
    select: { id: true, status: true, startedOn: true },
  });
  if (!checklist) return { ok: false, error: "Checklist not found." };
  if (checklist.status === input.status) return { ok: true }; // no-op

  await withAudit(
    {
      ...input.actor,
      action: "turnover.status_changed",
      entityType: "TurnoverChecklist",
      entityId: checklist.id,
      before: { status: checklist.status },
    },
    async (tx) => {
      const updated = await tx.turnoverChecklist.update({
        where: { id: checklist.id },
        data: {
          status: input.status,
          startedOn:
            checklist.startedOn ??
            (input.status !== "open" ? new Date() : null),
          readyOn: input.status === "ready" ? new Date() : null,
        },
      });
      return { result: updated, after: { status: input.status } };
    },
  );
  return { ok: true };
}

/** Delete an entire checklist (and its items, via cascade). */
export async function deleteTurnoverChecklist(input: {
  checklistId: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const checklist = await prisma.turnoverChecklist.findUnique({
    where: { id: input.checklistId },
    select: { id: true, unitId: true, status: true },
  });
  if (!checklist) return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "turnover.checklist_deleted",
      entityType: "TurnoverChecklist",
      entityId: checklist.id,
      before: { unitId: checklist.unitId, status: checklist.status },
    },
    async (tx) => {
      await tx.turnoverChecklist.delete({ where: { id: checklist.id } });
      return { result: undefined };
    },
  );
  return { ok: true };
}

/** Bump updatedAt so the checklist reflects its latest item activity. */
async function touchChecklist(tx: Tx, checklistId: string): Promise<void> {
  await tx.turnoverChecklist.update({
    where: { id: checklistId },
    data: { updatedAt: new Date() },
  });
}

/**
 * Re-derive an OPEN checklist's status from its items after a done/delete. Never
 * overrides a manually-set `ready` (a terminal state is staff's call to reopen),
 * and never auto-advances all the way to `ready` from open work — it only moves
 * open <-> in_progress, leaving the final `ready` sign-off to staff via the
 * status control. Always touches updatedAt.
 */
async function syncChecklistFromItems(
  tx: Tx,
  checklistId: string,
): Promise<void> {
  const cl = await tx.turnoverChecklist.findUnique({
    where: { id: checklistId },
    select: { status: true, startedOn: true, items: { select: { done: true } } },
  });
  if (!cl) return;
  if (!isTurnoverOpen(cl.status)) {
    // `ready` is terminal — only touch the timestamp.
    await touchChecklist(tx, checklistId);
    return;
  }
  const derived = deriveTurnoverStatus(cl.items);
  // Auto-advance only between the two open states; the `ready` sign-off stays
  // manual (derived `ready` is treated as in_progress here).
  const next = derived === "ready" ? "in_progress" : derived;
  await tx.turnoverChecklist.update({
    where: { id: checklistId },
    data: {
      status: next,
      startedOn: cl.startedOn ?? (next !== "open" ? new Date() : null),
      updatedAt: new Date(),
    },
  });
}
