import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listInspectionTemplates } from "@/lib/services/inspection-templates";
import { INSPECTION_TYPES, inspectionTypeLabel } from "@/lib/inspections/disposition";
import {
  createTemplateAction,
  deleteTemplateAction,
  setTemplateActiveAction,
  updateTemplateAction,
} from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const runtime = "nodejs";

interface TemplateDefaults {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  itemsText: string;
}

/** Render the template's ordered items back into the editor's line format. */
function itemsToText(
  items: { label: string; area: string | null; category: string | null }[],
): string {
  return items
    .map((it) =>
      [it.label, it.area ?? "", it.category ?? ""]
        .join(" | ")
        // trim trailing empty " | " segments for readability
        .replace(/(\s*\|\s*)+$/, ""),
    )
    .join("\n");
}

function TemplateFields({ defaults }: { defaults?: TemplateDefaults }) {
  const k = defaults?.id ?? "new";
  return (
    <>
      {defaults && <input type="hidden" name="templateId" value={defaults.id} />}
      <div className="space-y-2">
        <Label htmlFor={`name-${k}`}>Name</Label>
        <Input
          id={`name-${k}`}
          name="name"
          required
          defaultValue={defaults?.name}
          placeholder="e.g. Move-out walkthrough"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`type-${k}`}>Default inspection type (optional)</Label>
        <select
          id={`type-${k}`}
          name="type"
          defaultValue={defaults?.type ?? ""}
          className="h-9 w-full rounded-md border px-3 text-sm"
        >
          <option value="">— any —</option>
          {INSPECTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {inspectionTypeLabel(t)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`desc-${k}`}>Description (optional)</Label>
        <Input
          id={`desc-${k}`}
          name="description"
          defaultValue={defaults?.description ?? ""}
          placeholder="What this template is for"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`items-${k}`}>Checklist items</Label>
        <Textarea
          id={`items-${k}`}
          name="items"
          rows={8}
          defaultValue={defaults?.itemsText ?? ""}
          placeholder={"One item per line. Optional area and category after pipes:\nWalls & ceilings | Living room | Condition\nSmoke detector | | Safety\nFaucets & drains | Kitchen"}
        />
        <p className="text-xs text-muted-foreground">
          One item per line. After the label you can add an optional area and
          category separated by <code>|</code> (pipe), e.g.{" "}
          <code>Walls &amp; ceilings | Living room | Condition</code>.
        </p>
      </div>
    </>
  );
}

export default async function InspectionTemplatesPage() {
  await requireCapability("inspections.manage");
  const settings = await getAppSettings();
  if (!settings.modules.inspections) redirect("/dashboard");

  const templates = await listInspectionTemplates();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inspection templates</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Reusable condition checklists (Move-in, Move-out, Routine…). When you
            schedule an inspection you can pick a template to pre-populate its
            items. Editing a template only affects new inspections — past ones
            keep the items they were created with.
          </p>
        </div>
        <FormDialog
          trigger="Add template"
          triggerVariant="default"
          title="Add inspection template"
          action={createTemplateAction}
          submitLabel="Create template"
          wide
        >
          <TemplateFields />
        </FormDialog>
      </div>

      <DataTable
        emptyMessage="No templates yet. Add one to speed up scheduling inspections."
        columns={[
          { key: "name", label: "Name" },
          { key: "type", label: "Type", className: "hidden sm:table-cell" },
          { key: "items", label: "Items", align: "right" },
          { key: "status", label: "Status" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={templates.map((t) => ({
          key: t.id,
          sortValues: [
            t.name,
            t.type ? inspectionTypeLabel(t.type) : "",
            t._count.items,
            t.isActive ? "active" : "inactive",
            null,
          ],
          cells: [
            <div key="n">
              <span className={t.isActive ? "font-medium" : "font-medium text-muted-foreground"}>
                {t.name}
              </span>
              {t.description && (
                <div className="text-xs text-muted-foreground">{t.description}</div>
              )}
            </div>,
            t.type ? inspectionTypeLabel(t.type) : "—",
            t._count.items,
            t.isActive ? (
              <span key="s" className="text-emerald-600 dark:text-emerald-400">Active</span>
            ) : (
              <span key="s" className="text-muted-foreground">Inactive</span>
            ),
            <div key="a" className="flex justify-end gap-2">
              <FormDialog
                trigger="Edit"
                triggerSize="xs"
                title={`Edit ${t.name}`}
                action={updateTemplateAction}
                submitLabel="Save"
                wide
              >
                <TemplateFields
                  defaults={{
                    id: t.id,
                    name: t.name,
                    type: t.type,
                    description: t.description,
                    itemsText: itemsToText(t.items),
                  }}
                />
              </FormDialog>
              <form action={setTemplateActiveAction}>
                <input type="hidden" name="templateId" value={t.id} />
                <input type="hidden" name="isActive" value={t.isActive ? "false" : "true"} />
                <Button type="submit" variant="outline" size="xs">
                  {t.isActive ? "Deactivate" : "Activate"}
                </Button>
              </form>
              <form action={deleteTemplateAction}>
                <input type="hidden" name="templateId" value={t.id} />
                <ConfirmSubmitButton
                  variant="destructive"
                  size="xs"
                  confirmMessage="Delete this template? Inspections already created from it keep their items."
                >
                  Delete
                </ConfirmSubmitButton>
              </form>
            </div>,
          ],
        }))}
      />
    </div>
  );
}
