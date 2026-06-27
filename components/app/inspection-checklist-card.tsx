import {
  addChecklistItemAction,
  addChecklistPhotosAction,
  deleteChecklistPhotoAction,
  removeChecklistItemAction,
  updateChecklistItemAction,
} from "@/app/(app)/inspections/actions";
import {
  CHECKLIST_STATUSES,
  checklistStatusClass,
  checklistStatusLabel,
} from "@/lib/inspections/checklist";
import type { ChecklistPhotoView } from "@/lib/services/inspections";
import type { InspectionChecklistStatus } from "@/lib/generated/prisma/enums";
import { formatCurrency, fromCents } from "@/lib/money";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { FormDialog } from "@/components/app/form-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export interface ChecklistItemView {
  id: string;
  label: string;
  area: string | null;
  category: string | null;
  status: InspectionChecklistStatus;
  note: string | null;
  amountCents: bigint;
  photos: ChecklistPhotoView[];
}

function StatusPill({ status }: { status: InspectionChecklistStatus }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${checklistStatusClass(status)}`}
    >
      {checklistStatusLabel(status)}
    </span>
  );
}

/**
 * Condition CHECKLIST for one inspection: ordered items, each with a pass/fail/na
 * status, a note, photos, and — on a move-out (showAmount) — an optional deposit
 * deduction that feeds the move-out disposition. Photos are served via short-lived
 * signed URLs (the same mechanism as condition/maintenance photos), reachable only
 * by staff with the inspections capability that gates this page. The deduction is
 * an operating figure — the disposition never touches the ledger.
 */
export function InspectionChecklistCard({
  inspectionId,
  items,
  editable,
  showAmount = false,
}: {
  inspectionId: string;
  items: ChecklistItemView[];
  editable: boolean;
  /** Show + edit a per-item deposit deduction (move-out inspections). */
  showAmount?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Condition checklist</CardTitle>
          <p className="text-xs text-muted-foreground">
            Per-item condition, notes, and photos. Operating record only — never
            affects tenant balances.
          </p>
        </div>
        {editable && (
          <FormDialog
            trigger="Add item"
            triggerSize="xs"
            title="Add checklist item"
            action={addChecklistItemAction}
            submitLabel="Add"
          >
            <input type="hidden" name="inspectionId" value={inspectionId} />
            <div className="space-y-2">
              <Label htmlFor="ci-label">What to check</Label>
              <Input id="ci-label" name="label" required placeholder="e.g. Walls & ceilings" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ci-area">Area (optional)</Label>
                <Input id="ci-area" name="area" placeholder="e.g. Kitchen" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ci-category">Category (optional)</Label>
                <Input id="ci-category" name="category" placeholder="e.g. Safety" />
              </div>
            </div>
            {showAmount && (
              <div className="space-y-2">
                <Label htmlFor="ci-amount">Deposit deduction (optional)</Label>
                <Input id="ci-amount" name="amount" inputMode="decimal" placeholder="0.00" />
                <p className="text-xs text-muted-foreground">
                  Counts toward the move-out deductions total. Leave blank for none.
                </p>
              </div>
            )}
          </FormDialog>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No checklist items yet
            {editable
              ? " — add them one by one, or schedule with a template to pre-populate."
              : "."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <li key={item.id} className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill status={item.status} />
                      <span className="font-medium">{item.label}</span>
                      {showAmount && item.amountCents > 0n && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          −{formatCurrency(item.amountCents)} deduction
                        </span>
                      )}
                    </div>
                    {(item.area || item.category) && (
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[item.area, item.category].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                  {editable && (
                    <div className="flex shrink-0 items-center gap-2">
                      <FormDialog
                        trigger="Edit"
                        triggerSize="xs"
                        title={`Edit: ${item.label}`}
                        action={updateChecklistItemAction}
                        submitLabel="Save"
                      >
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="inspectionId" value={inspectionId} />
                        <div className="space-y-2">
                          <Label htmlFor={`status-${item.id}`}>Condition</Label>
                          <select
                            id={`status-${item.id}`}
                            name="status"
                            defaultValue={item.status}
                            className="h-9 w-full rounded-md border px-3 text-sm"
                          >
                            {CHECKLIST_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {checklistStatusLabel(s)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`note-${item.id}`}>Note</Label>
                          <Textarea
                            id={`note-${item.id}`}
                            name="note"
                            rows={3}
                            defaultValue={item.note ?? ""}
                            placeholder="What you observed"
                          />
                        </div>
                        {showAmount && (
                          <div className="space-y-2">
                            <Label htmlFor={`amount-${item.id}`}>Deposit deduction</Label>
                            <Input
                              id={`amount-${item.id}`}
                              name="amount"
                              inputMode="decimal"
                              defaultValue={item.amountCents > 0n ? fromCents(item.amountCents) : ""}
                              placeholder="0.00"
                            />
                            <p className="text-xs text-muted-foreground">
                              Counts toward the move-out deductions total. Blank or 0 clears it.
                            </p>
                          </div>
                        )}
                      </FormDialog>
                      <FormDialog
                        trigger="Photos"
                        triggerSize="xs"
                        title={`Add photos: ${item.label}`}
                        action={addChecklistPhotosAction}
                        submitLabel="Upload"
                        wide
                      >
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="inspectionId" value={inspectionId} />
                        <div className="space-y-2">
                          <Label htmlFor={`photos-${item.id}`}>Photos</Label>
                          <input
                            id={`photos-${item.id}`}
                            name="photos"
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            capture="environment"
                            multiple
                            className="block text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted/70"
                          />
                          <p className="text-xs text-muted-foreground">
                            Up to 5 images (JPG/PNG/WebP, 10 MB each).
                          </p>
                        </div>
                      </FormDialog>
                      <form action={removeChecklistItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="inspectionId" value={inspectionId} />
                        <ConfirmSubmitButton
                          variant="outline"
                          size="xs"
                          confirmMessage="Remove this checklist item and its photos? This cannot be undone."
                        >
                          Remove
                        </ConfirmSubmitButton>
                      </form>
                    </div>
                  )}
                </div>

                {item.note && (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                    {item.note}
                  </p>
                )}

                {item.photos.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {item.photos.map((p) => (
                      <div key={p.id} className="group relative">
                        {p.url ? (
                          <a href={p.url} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, not optimizable */}
                            <img
                              src={p.url}
                              alt={p.fileName ?? "Inspection photo"}
                              className="aspect-square w-full rounded-md border object-cover"
                            />
                          </a>
                        ) : (
                          <div className="flex aspect-square w-full items-center justify-center rounded-md border text-xs text-muted-foreground">
                            (unavailable)
                          </div>
                        )}
                        {editable && (
                          <form
                            action={deleteChecklistPhotoAction}
                            className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100"
                          >
                            <input type="hidden" name="photoId" value={p.id} />
                            <input type="hidden" name="inspectionId" value={inspectionId} />
                            <ConfirmSubmitButton
                              variant="destructive"
                              size="xs"
                              confirmMessage="Delete this photo?"
                            >
                              ✕
                            </ConfirmSubmitButton>
                          </form>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
