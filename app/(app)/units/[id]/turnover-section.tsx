import { prisma } from "@/lib/db";
import {
  TURNOVER_STATUSES,
  isTurnoverOpen,
  turnoverProgress,
  turnoverStatusBadgeClass,
  turnoverStatusLabel,
} from "@/lib/maintenance/turnover-status";
import { listTurnoverChecklistsForUnit } from "@/lib/services/turnover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addTurnoverItemAction,
  createTurnoverChecklistAction,
  deleteTurnoverChecklistAction,
  deleteTurnoverItemAction,
  setTurnoverStatusAction,
  toggleTurnoverItemDoneAction,
  updateTurnoverItemAction,
} from "./turnover-actions";

/**
 * Turnover / make-ready section for the unit detail page. Shows the active (or
 * most-recent) checklist with its items in a DataTable, a done/total progress
 * indicator, and add/edit via FormDialog. Mirrors the maintenance-list patterns
 * (inline status/assignee dialogs, plain-form toggles). Gated upstream on the
 * maintenance module; mutations re-check maintenance.manage in their actions.
 */
export async function TurnoverSection({
  unitId,
  tz,
}: {
  unitId: string;
  tz: string;
}) {
  const [checklists, staff, leases] = await Promise.all([
    listTurnoverChecklistsForUnit(unitId),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    prisma.lease.findMany({
      where: { unitId, status: { not: "draft" } },
      orderBy: { startDate: "desc" },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        tenant: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const staffById = new Map(staff.map((u) => [u.id, u.name?.trim() || u.email]));
  const fmtLeaseDate = (d: Date) =>
    d.toLocaleDateString("en-US", { timeZone: tz });

  // Surface the most relevant checklist: the active one if present, else the
  // newest (which the list already returns first). There is at most one active.
  const active = checklists.find((c) => isTurnoverOpen(c.status));
  const current = active ?? checklists[0] ?? null;
  const hasActive = !!active;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Turnover / make-ready</CardTitle>
          <p className="text-xs text-muted-foreground">
            Rent-ready checklist worked between tenancies. An operating record —
            it never affects tenant balances.
          </p>
        </div>
        {!hasActive && (
          <FormDialog
            trigger="Start checklist"
            title="Start a turnover checklist"
            description="Seeds a templated make-ready checklist you can edit."
            action={createTurnoverChecklistAction}
            submitLabel="Start checklist"
          >
            <input type="hidden" name="unitId" value={unitId} />
            <div className="space-y-2">
              <Label htmlFor="to-title">Title (optional)</Label>
              <Input
                id="to-title"
                name="title"
                placeholder="e.g. Turnover — summer 2026"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to-lease">Ending lease (optional)</Label>
              <select
                id="to-lease"
                name="leaseId"
                defaultValue=""
                className="h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">— not linked —</option>
                {leases.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.tenant.firstName} {l.tenant.lastName} (
                    {fmtLeaseDate(l.startDate)}
                    {l.endDate ? `–${fmtLeaseDate(l.endDate)}` : "–present"})
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Link the tenancy this turnover follows, for context.
              </p>
            </div>
          </FormDialog>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!current ? (
          <p className="text-sm text-muted-foreground">
            No turnover checklist yet. Start one when a tenant moves out to track
            the make-ready work.
          </p>
        ) : (
          <TurnoverChecklistView
            unitId={unitId}
            checklist={current}
            isActive={isTurnoverOpen(current.status)}
            staff={staff}
            staffById={staffById}
          />
        )}
      </CardContent>
    </Card>
  );
}

type Checklist = Awaited<
  ReturnType<typeof listTurnoverChecklistsForUnit>
>[number];

function TurnoverChecklistView({
  unitId,
  checklist,
  isActive,
  staff,
  staffById,
}: {
  unitId: string;
  checklist: Checklist;
  isActive: boolean;
  staff: { id: string; name: string | null; email: string }[];
  staffById: Map<string, string>;
}) {
  const progress = turnoverProgress(checklist.items);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={`font-medium ${turnoverStatusBadgeClass(checklist.status)}`}
          >
            {turnoverStatusLabel(checklist.status)}
          </Badge>
          {checklist.title && (
            <span className="text-sm font-medium">{checklist.title}</span>
          )}
          {!isActive && (
            <span className="text-xs text-muted-foreground">
              (most recent)
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FormDialog
            trigger="Set status"
            triggerSize="xs"
            title="Set checklist status"
            description={checklist.title ?? "Turnover checklist"}
            action={setTurnoverStatusAction}
            submitLabel="Save status"
          >
            <input type="hidden" name="unitId" value={unitId} />
            <input type="hidden" name="checklistId" value={checklist.id} />
            <div className="space-y-2">
              <Label htmlFor={`to-status-${checklist.id}`}>Status</Label>
              <select
                id={`to-status-${checklist.id}`}
                name="status"
                defaultValue={checklist.status}
                className="h-9 w-full rounded-md border px-3 text-sm"
              >
                {TURNOVER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {turnoverStatusLabel(s)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Mark <strong>Ready</strong> when the unit is rent-ready. Open
                states track in progress automatically as items are checked.
              </p>
            </div>
          </FormDialog>
          {isActive && (
            <FormDialog
              trigger="Add item"
              triggerVariant="default"
              triggerSize="xs"
              title="Add a checklist item"
              action={addTurnoverItemAction}
              submitLabel="Add item"
            >
              <input type="hidden" name="unitId" value={unitId} />
              <input type="hidden" name="checklistId" value={checklist.id} />
              <div className="space-y-2">
                <Label htmlFor={`to-add-label-${checklist.id}`}>Item</Label>
                <Input
                  id={`to-add-label-${checklist.id}`}
                  name="label"
                  required
                  placeholder="e.g. Shampoo carpets"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`to-add-area-${checklist.id}`}>
                  Area / category (optional)
                </Label>
                <Input
                  id={`to-add-area-${checklist.id}`}
                  name="area"
                  placeholder="e.g. Bedroom"
                />
              </div>
            </FormDialog>
          )}
          <form action={deleteTurnoverChecklistAction} className="inline">
            <input type="hidden" name="unitId" value={unitId} />
            <input type="hidden" name="checklistId" value={checklist.id} />
            <ConfirmSubmitButton
              variant="destructive"
              size="xs"
              confirmMessage="Delete this turnover checklist and all its items? This cannot be undone."
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>

      {/* Progress indicator: e.g. 3/8 done. */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {progress.done}/{progress.total} done
          </span>
          <span className="tabular-nums text-muted-foreground">
            {progress.percent}%
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Checklist progress"
        >
          <div
            className="h-full rounded-full bg-emerald-500 transition-all dark:bg-emerald-400"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      <DataTable
        defaultSort={{ key: "order", dir: "asc" }}
        emptyMessage="No items yet — add make-ready tasks above."
        columns={[
          { key: "order", label: "#", numeric: true, className: "w-12" },
          { key: "done", label: "Done" },
          { key: "item", label: "Item" },
          { key: "area", label: "Area", className: "hidden sm:table-cell" },
          {
            key: "assignee",
            label: "Assignee",
            className: "hidden md:table-cell",
          },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={checklist.items.map((it, i) => {
          const assigneeName = it.assignedToUserId
            ? staffById.get(it.assignedToUserId) ?? "Former staff"
            : null;
          return {
            key: it.id,
            sortValues: [
              it.orderIndex,
              it.done ? "1" : "0",
              it.label,
              it.area,
              assigneeName,
              null,
            ],
            cells: [
              i + 1,
              <form
                key="d"
                action={toggleTurnoverItemDoneAction}
                className="inline"
              >
                <input type="hidden" name="unitId" value={unitId} />
                <input type="hidden" name="itemId" value={it.id} />
                <input
                  type="hidden"
                  name="done"
                  value={it.done ? "false" : "true"}
                />
                <Button
                  type="submit"
                  variant={it.done ? "secondary" : "outline"}
                  size="xs"
                  disabled={!isActive}
                  title={
                    isActive
                      ? undefined
                      : "Reopen the checklist to change items."
                  }
                >
                  {it.done ? "Done" : "Mark done"}
                </Button>
              </form>,
              <span
                key="i"
                className={
                  it.done ? "text-muted-foreground line-through" : "font-medium"
                }
              >
                {it.label}
                {it.notes && (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {it.notes}
                  </span>
                )}
              </span>,
              it.area ? (
                <Badge key="a" variant="outline" className="font-normal">
                  {it.area}
                </Badge>
              ) : (
                "—"
              ),
              <span
                key="asg"
                className={
                  assigneeName ? "text-sm" : "text-sm text-muted-foreground"
                }
              >
                {assigneeName ?? "Unassigned"}
              </span>,
              <span key="act" className="inline-flex justify-end gap-1">
                {isActive && (
                  <FormDialog
                    trigger="Edit"
                    triggerVariant="outline"
                    triggerSize="xs"
                    title="Edit item"
                    action={updateTurnoverItemAction}
                    submitLabel="Save item"
                  >
                    <input type="hidden" name="unitId" value={unitId} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <div className="space-y-2">
                      <Label htmlFor={`to-edit-label-${it.id}`}>Item</Label>
                      <Input
                        id={`to-edit-label-${it.id}`}
                        name="label"
                        required
                        defaultValue={it.label}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`to-edit-area-${it.id}`}>
                        Area / category
                      </Label>
                      <Input
                        id={`to-edit-area-${it.id}`}
                        name="area"
                        defaultValue={it.area ?? ""}
                        placeholder="Optional"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`to-edit-assignee-${it.id}`}>
                        Assignee
                      </Label>
                      <select
                        id={`to-edit-assignee-${it.id}`}
                        name="assignedToUserId"
                        defaultValue={it.assignedToUserId ?? ""}
                        className="h-9 w-full rounded-md border px-3 text-sm"
                      >
                        <option value="">— unassigned —</option>
                        {staff.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name?.trim() || u.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`to-edit-notes-${it.id}`}>Notes</Label>
                      <Textarea
                        id={`to-edit-notes-${it.id}`}
                        name="notes"
                        defaultValue={it.notes ?? ""}
                        placeholder="Optional"
                      />
                    </div>
                  </FormDialog>
                )}
                {isActive && (
                  <form action={deleteTurnoverItemAction} className="inline">
                    <input type="hidden" name="unitId" value={unitId} />
                    <input type="hidden" name="itemId" value={it.id} />
                    <ConfirmSubmitButton
                      variant="destructive"
                      size="xs"
                      confirmMessage="Delete this item?"
                    >
                      Delete
                    </ConfirmSubmitButton>
                  </form>
                )}
              </span>,
            ],
          };
        })}
      />
    </div>
  );
}
