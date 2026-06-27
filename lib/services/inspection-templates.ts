import { prisma } from "@/lib/db";
import { withAudit, type AuditContext } from "@/lib/audit/audit";
import type { InspectionType } from "@/lib/generated/prisma/enums";

/**
 * Reusable inspection CHECKLIST templates (e.g. "Move-in", "Move-out",
 * "Routine"): an ordered list of condition items staff pre-populate a new
 * inspection from. Managed at Settings → Inspection templates. Operating
 * configuration records — they never touch the ledger or deposit disposition.
 * Every mutation is audited.
 */

/** One template line as entered in the editor textarea: "Label | Area | Category". */
export interface ParsedTemplateLine {
  label: string;
  area: string | null;
  category: string | null;
}

/**
 * Parse the template-items textarea into ordered lines. One item per line; an
 * optional pipe-delimited area and category follow the label
 * ("Walls & ceilings | Living room | Condition"). Blank lines are dropped.
 */
export function parseTemplateItems(raw: string): ParsedTemplateLine[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [label, area, category] = line.split("|").map((p) => p.trim());
      return {
        label: label.slice(0, 200),
        area: area ? area.slice(0, 100) : null,
        category: category ? category.slice(0, 100) : null,
      };
    })
    .filter((l) => l.label.length > 0);
}

export function listInspectionTemplates() {
  return prisma.inspectionTemplate.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      _count: { select: { items: true } },
      items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
}

/** Active templates with their ordered items — for the "Schedule inspection" picker. */
export function listActiveTemplatesWithItems() {
  return prisma.inspectionTemplate.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
}

export function getInspectionTemplate(id: string) {
  return prisma.inspectionTemplate.findUnique({
    where: { id },
    include: { items: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } },
  });
}

export async function createInspectionTemplate(input: {
  name: string;
  type: InspectionType | null;
  description: string | null;
  items: ParsedTemplateLine[];
  actor: AuditContext;
}): Promise<{ id: string } | { error: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Name the template." };

  const created = await withAudit(
    {
      ...input.actor,
      action: "inspection_template.created",
      entityType: "InspectionTemplate",
      entityId: "(new)",
    },
    async (tx) => {
      const row = await tx.inspectionTemplate.create({
        data: {
          name,
          type: input.type,
          description: input.description,
          createdBy: input.actor.actorId ?? null,
          items: {
            create: input.items.map((it, i) => ({
              label: it.label,
              area: it.area,
              category: it.category,
              sortOrder: i,
            })),
          },
        },
      });
      return {
        result: row,
        entityId: row.id,
        after: { name, type: input.type, itemCount: input.items.length },
      };
    },
  );
  return { id: created.id };
}

export async function updateInspectionTemplate(input: {
  id: string;
  name: string;
  type: InspectionType | null;
  description: string | null;
  items: ParsedTemplateLine[];
  actor: AuditContext;
}): Promise<{ ok: boolean; error?: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name the template." };
  const existing = await prisma.inspectionTemplate.findUnique({
    where: { id: input.id },
    select: { id: true, name: true },
  });
  if (!existing) return { ok: false, error: "Template not found." };

  await withAudit(
    {
      ...input.actor,
      action: "inspection_template.updated",
      entityType: "InspectionTemplate",
      entityId: input.id,
      before: { name: existing.name },
    },
    async (tx) => {
      await tx.inspectionTemplate.update({
        where: { id: input.id },
        data: { name, type: input.type, description: input.description },
      });
      // Items are managed as a set: replace wholesale so the editor textarea is
      // the source of truth (no dangling rows). Past inspections already hold
      // their own copied checklist items, so this never rewrites history.
      await tx.inspectionTemplateItem.deleteMany({ where: { templateId: input.id } });
      if (input.items.length > 0) {
        await tx.inspectionTemplateItem.createMany({
          data: input.items.map((it, i) => ({
            templateId: input.id,
            label: it.label,
            area: it.area,
            category: it.category,
            sortOrder: i,
          })),
        });
      }
      return { result: undefined, after: { name, type: input.type, itemCount: input.items.length } };
    },
  );
  return { ok: true };
}

/** Toggle a template active/inactive (inactive templates are hidden from the picker). */
export async function setInspectionTemplateActive(input: {
  id: string;
  isActive: boolean;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const existing = await prisma.inspectionTemplate.findUnique({
    where: { id: input.id },
    select: { isActive: true },
  });
  if (!existing || existing.isActive === input.isActive) return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "inspection_template.active_changed",
      entityType: "InspectionTemplate",
      entityId: input.id,
      before: { isActive: existing.isActive },
    },
    async (tx) => {
      await tx.inspectionTemplate.update({
        where: { id: input.id },
        data: { isActive: input.isActive },
      });
      return { result: undefined, after: { isActive: input.isActive } };
    },
  );
  return { ok: true };
}

export async function deleteInspectionTemplate(input: {
  id: string;
  actor: AuditContext;
}): Promise<{ ok: boolean }> {
  const existing = await prisma.inspectionTemplate.findUnique({
    where: { id: input.id },
    select: { name: true },
  });
  if (!existing) return { ok: true };
  await withAudit(
    {
      ...input.actor,
      action: "inspection_template.deleted",
      entityType: "InspectionTemplate",
      entityId: input.id,
      before: { name: existing.name },
    },
    async (tx) => {
      // Items cascade; inspections.templateId is SetNull (history preserved).
      await tx.inspectionTemplate.delete({ where: { id: input.id } });
      return { result: undefined };
    },
  );
  return { ok: true };
}
