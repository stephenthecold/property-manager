import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { formatCurrency } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  addJobAttachmentAction,
  addJobUpdateAction,
  completeJobAction,
  createJobAction,
  createTaskAction,
  deleteJobAction,
  editTaskScheduleAction,
  markTaskDoneAction,
  removeTaskAction,
  reopenJobAction,
  setJobPriorityAction,
} from "./actions";
import { getDocumentDownloadUrl } from "@/lib/services/documents";
import { listActiveVendors } from "@/lib/services/vendors";
import {
  MAINTENANCE_PRIORITIES,
  priorityLabel,
} from "@/lib/maintenance/priority";
import type { MaintenancePriority } from "@/lib/generated/prisma/enums";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const runtime = "nodejs";

/** Themed badge tints per priority (every tint carries a dark: variant). */
const PRIORITY_BADGE: Record<MaintenancePriority, string> = {
  urgent:
    "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  high: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  normal:
    "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  low: "border-muted bg-muted text-muted-foreground",
};

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd" … */
function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("maintenance.manage");
  const settings = await getAppSettings();
  if (!settings.modules.maintenance) redirect("/dashboard");

  const sp = await searchParams;
  const first = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const error = first("error") || null;
  const filterPropertyId = first("propertyId") || undefined;
  const filterStatus = first("status") === "completed" ? "completed" : first("status") === "pending" ? "pending" : undefined;

  const jobWhere: Prisma.MaintenanceJobWhereInput = {};
  if (filterPropertyId) jobWhere.propertyId = filterPropertyId;
  if (filterStatus) jobWhere.status = filterStatus;

  const [jobs, tasks, properties, units, vendors] = await Promise.all([
    prisma.maintenanceJob.findMany({
      where: jobWhere,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 300,
      include: {
        property: { select: { name: true, timezone: true, currency: true } },
        unit: { select: { unitNumber: true } },
        vendor: { select: { name: true } },
        updates: { orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.recurringTask.findMany({
      where: { active: true },
      orderBy: [{ property: { name: "asc" } }, { title: "asc" }],
      include: { property: { select: { name: true, timezone: true } } },
    }),
    prisma.property.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.unit.findMany({
      orderBy: [{ property: { name: "asc" } }, { unitNumber: "asc" }],
      select: { id: true, unitNumber: true, property: { select: { name: true } } },
    }),
    settings.modules.vendors ? listActiveVendors() : Promise.resolve([]),
  ]);

  // Attachments (loose ref) for the visible jobs, with signed download URLs.
  const jobIds = jobs.map((j) => j.id);
  const attachmentDocs = jobIds.length
    ? await prisma.uploadedDocument.findMany({
        where: { maintenanceJobId: { in: jobIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, maintenanceJobId: true },
      })
    : [];
  const attachmentsByJob = new Map<
    string,
    { id: string; fileName: string; url: string | null }[]
  >();
  for (const d of attachmentDocs) {
    if (!d.maintenanceJobId) continue;
    let url: string | null = null;
    try {
      url = (await getDocumentDownloadUrl(d.id))?.url ?? null;
    } catch {
      url = null; // storage not configured — list the name without a link
    }
    const arr = attachmentsByJob.get(d.maintenanceJobId) ?? [];
    arr.push({ id: d.id, fileName: d.fileName ?? "file", url });
    attachmentsByJob.set(d.maintenanceJobId, arr);
  }

  const now = new Date();
  const doneThisMonth = (t: (typeof tasks)[number]) =>
    !!t.lastDoneOn &&
    DateTime.fromJSDate(t.lastDoneOn, { zone: t.property.timezone }).hasSame(
      DateTime.fromJSDate(now, { zone: t.property.timezone }),
      "month",
    );

  const openJobs = jobs.filter((j) => j.status === "pending").length;

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Maintenance</h1>
          <p className="text-sm text-muted-foreground">
            {openJobs} open job{openJobs === 1 ? "" : "s"} · completed jobs with a
            cost are logged to Financials automatically.
          </p>
        </div>
        <FormDialog trigger="Add job" triggerVariant="default" title="Add maintenance job">
          <form action={createJobAction} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="mjTitle">Title</Label>
              <Input id="mjTitle" name="title" placeholder="Replace water heater" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mjUnit">Unit (optional)</Label>
              <select
                id="mjUnit"
                name="unitId"
                className="h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">— property-wide —</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.property.name} · {u.unitNumber}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mjProperty">Property (when no unit picked)</Label>
              <select
                id="mjProperty"
                name="propertyId"
                className="h-9 w-full rounded-md border px-3 text-sm"
              >
                <option value="">— select —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            {settings.modules.vendors && vendors.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="mjVendor">Vendor (optional)</Label>
                <select
                  id="mjVendor"
                  name="vendorId"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— none —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="mjDue">Due date (optional)</Label>
              <Input id="mjDue" name="dueDate" type="date" />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex h-9 items-center gap-2 text-sm">
                <input type="checkbox" name="notifyTenants" /> Notify tenants by
                SMS
              </label>
              <div className="space-y-2">
                <Label htmlFor="mjNotifyDays">Days before</Label>
                <Input
                  id="mjNotifyDays"
                  name="notifyDaysBefore"
                  type="number"
                  min={0}
                  max={14}
                  defaultValue={2}
                  className="w-24"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Notifications need a due date; consenting tenants get one text per
              job starting that many days ahead.
            </p>
            <div className="space-y-2">
              <Label htmlFor="mjPriority">Priority</Label>
              <select
                id="mjPriority"
                name="priority"
                defaultValue="normal"
                className="h-9 w-40 rounded-md border px-3 text-sm capitalize"
              >
                {MAINTENANCE_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mjDetails">Details</Label>
              <Textarea id="mjDetails" name="details" />
            </div>
            <Button type="submit" size="sm">
              Add job
            </Button>
          </form>
        </FormDialog>
      </div>

      <Card className="border-t-4 border-t-sky-500">
        <CardHeader>
          <CardTitle>Unit jobs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="fProperty">Property</Label>
              <select
                id="fProperty"
                name="propertyId"
                defaultValue={filterPropertyId ?? ""}
                className="h-9 w-48 rounded-md border px-3 text-sm"
              >
                <option value="">All properties</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fStatus">Status</Label>
              <select
                id="fStatus"
                name="status"
                defaultValue={filterStatus ?? ""}
                className="h-9 w-36 rounded-md border px-3 text-sm capitalize"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
              </select>
            </div>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {(filterPropertyId || filterStatus) && (
              <Button variant="ghost" size="sm" render={<Link href="/maintenance" />}>
                Clear
              </Button>
            )}
          </form>

          <DataTable
            emptyMessage="No maintenance jobs yet."
            columns={[
              { key: "created", label: "Created", className: "hidden md:table-cell" },
              { key: "property", label: "Property", className: "hidden sm:table-cell" },
              { key: "unit", label: "Unit" },
              { key: "title", label: "Job" },
              { key: "priority", label: "Priority" },
              { key: "due", label: "Due" },
              { key: "status", label: "Status" },
              { key: "notes", label: "Notes", align: "right", sortable: false, className: "hidden sm:table-cell" },
              { key: "files", label: "Files", align: "right", sortable: false, className: "hidden md:table-cell" },
              { key: "cost", label: "Cost", align: "right", numeric: true, className: "hidden lg:table-cell" },
              { key: "actions", label: "", align: "right", sortable: false },
            ]}
            rows={jobs.map((j) => {
              const overdue =
                j.status === "pending" && j.dueDate != null && j.dueDate.getTime() < now.getTime();
              return {
                key: j.id,
                sortValues: [
                  j.createdAt.toISOString(),
                  j.property.name,
                  j.unit?.unitNumber ?? null,
                  j.title,
                  j.priority,
                  j.dueDate?.toISOString() ?? null,
                  j.status,
                  j.updates.length,
                  (attachmentsByJob.get(j.id) ?? []).length,
                  j.costCents != null ? String(j.costCents) : null,
                  null,
                ],
                cells: [
                  j.createdAt.toLocaleDateString(),
                  j.property.name,
                  j.unit?.unitNumber ?? "—",
                  <span key="t" title={j.details ?? undefined} className="font-medium">
                    <Link href={`/maintenance/${j.id}`} className="hover:underline">
                      {j.title}
                    </Link>
                    {j.vendor && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        Vendor: {j.vendor.name}
                      </span>
                    )}
                  </span>,
                  <span key="pri" className="inline-flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className={`font-medium capitalize ${PRIORITY_BADGE[j.priority]}`}
                    >
                      {priorityLabel(j.priority)}
                    </Badge>
                    <FormDialog
                      trigger="Edit"
                      triggerVariant="ghost"
                      triggerSize="xs"
                      title="Change priority"
                      description={j.title}
                      action={setJobPriorityAction}
                      submitLabel="Save priority"
                    >
                      <input type="hidden" name="jobId" value={j.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`pri-${j.id}`}>Priority</Label>
                        <select
                          id={`pri-${j.id}`}
                          name="priority"
                          defaultValue={j.priority}
                          className="h-9 w-full rounded-md border px-3 text-sm capitalize"
                        >
                          {MAINTENANCE_PRIORITIES.map((p) => (
                            <option key={p} value={p}>
                              {priorityLabel(p)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </FormDialog>
                  </span>,
                  j.dueDate ? (
                    <span
                      key="due"
                      className={overdue ? "font-medium text-red-600 dark:text-red-400" : undefined}
                    >
                      {j.dueDate.toLocaleDateString("en-US", { timeZone: "UTC" })}
                    </span>
                  ) : (
                    "—"
                  ),
                  j.status === "completed" ? (
                    <Badge
                      key="s"
                      variant="outline"
                      className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                    >
                      Completed
                    </Badge>
                  ) : (
                    <Badge
                      key="s"
                      variant="outline"
                      className="border-amber-200 bg-amber-100 font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                    >
                      Pending
                    </Badge>
                  ),
                  <FormDialog
                    key="notes"
                    trigger={`Notes (${j.updates.length})`}
                    triggerVariant="ghost"
                    triggerSize="xs"
                    title="Job updates"
                    description={j.title}
                    action={addJobUpdateAction}
                    submitLabel="Post update"
                  >
                    <input type="hidden" name="jobId" value={j.id} />
                    {j.updates.length > 0 && (
                      <ul className="max-h-56 space-y-2 overflow-y-auto text-sm">
                        {j.updates.map((u) => (
                          <li key={u.id} className="rounded-md border p-2">
                            <div className="whitespace-pre-wrap">{u.note}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {u.createdAt.toLocaleString()}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor={`note-${j.id}`}>Add an update</Label>
                      <Textarea
                        id={`note-${j.id}`}
                        name="note"
                        rows={3}
                        placeholder="Progress, parts ordered, vendor scheduled…"
                      />
                    </div>
                  </FormDialog>,
                  (() => {
                    const files = attachmentsByJob.get(j.id) ?? [];
                    return (
                      <FormDialog
                        key="files"
                        trigger={`Files (${files.length})`}
                        triggerVariant="ghost"
                        triggerSize="xs"
                        title="Job attachments"
                        description={j.title}
                        action={addJobAttachmentAction}
                        submitLabel="Upload attachment"
                      >
                        <input type="hidden" name="jobId" value={j.id} />
                        {files.length > 0 && (
                          <ul className="space-y-1 text-sm">
                            {files.map((f) => (
                              <li key={f.id}>
                                {f.url ? (
                                  <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary underline underline-offset-2"
                                  >
                                    {f.fileName}
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">{f.fileName}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor={`file-${j.id}`}>
                            Add a photo or PDF (max 10 MB)
                          </Label>
                          <input
                            id={`file-${j.id}`}
                            name="file"
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/heic,application/pdf"
                            className="block w-full text-sm"
                          />
                        </div>
                      </FormDialog>
                    );
                  })(),
                  <span key="c" className="tabular-nums">
                    {j.costCents != null ? formatCurrency(j.costCents, j.property.currency) : "—"}
                  </span>,
                  j.status === "pending" ? (
                    <span key="a" className="inline-flex justify-end gap-1">
                      <FormDialog
                        trigger="Complete"
                        triggerSize="xs"
                        title="Complete job"
                        description={j.title}
                        action={completeJobAction}
                        submitLabel="Mark completed"
                      >
                        <input type="hidden" name="jobId" value={j.id} />
                        <div className="space-y-2">
                          <Label htmlFor={`cost-${j.id}`}>
                            Cost (optional — logs a maintenance expense)
                          </Label>
                          <Input
                            id={`cost-${j.id}`}
                            name="cost"
                            inputMode="decimal"
                            placeholder="0.00"
                          />
                        </div>
                      </FormDialog>
                      <form action={deleteJobAction} className="inline">
                        <input type="hidden" name="jobId" value={j.id} />
                        <ConfirmSubmitButton
                          variant="ghost"
                          size="xs"
                          confirmMessage="Delete this maintenance job? It is removed permanently and cannot be recovered."
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </form>
                    </span>
                  ) : (
                    <form key="a" action={reopenJobAction} className="inline">
                      <input type="hidden" name="jobId" value={j.id} />
                      <Button type="submit" variant="outline" size="xs">
                        Reopen
                      </Button>
                    </form>
                  ),
                ],
              };
            })}
          />
        </CardContent>
      </Card>

      <Card className="border-t-4 border-t-emerald-500">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Monthly tasks</CardTitle>
          <FormDialog trigger="Add task" title="Add monthly task">
            <form action={createTaskAction} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="rtProperty">Property</Label>
                <select
                  id="rtProperty"
                  name="propertyId"
                  required
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— select —</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rtTitle">Task</Label>
                <Input id="rtTitle" name="title" placeholder="Mow & trim" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rtNotes">Notes</Label>
                <Input id="rtNotes" name="notes" placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="rtDueDay">Day of month (optional)</Label>
                <Input
                  id="rtDueDay"
                  name="dueDay"
                  type="number"
                  min={1}
                  max={31}
                  placeholder="e.g. 15"
                  className="w-24"
                />
              </div>
              <div className="flex items-end gap-4">
                <label className="flex h-9 items-center gap-2 text-sm">
                  <input type="checkbox" name="notifyTenants" /> Notify tenants
                  by SMS
                </label>
                <div className="space-y-2">
                  <Label htmlFor="rtNotifyDays">Days before</Label>
                  <Input
                    id="rtNotifyDays"
                    name="notifyDaysBefore"
                    type="number"
                    min={0}
                    max={14}
                    defaultValue={2}
                    className="w-24"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Notifications need a day of month; consenting tenants of the
                property get one text per occurrence starting that many days
                ahead.
              </p>
              <Button type="submit" size="sm">
                Add task
              </Button>
            </form>
          </FormDialog>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No monthly tasks yet — add recurring upkeep like mowing or pest spraying."
            columns={[
              { key: "property", label: "Property" },
              { key: "task", label: "Task" },
              { key: "schedule", label: "Schedule", className: "hidden sm:table-cell" },
              { key: "notify", label: "Notify", className: "hidden md:table-cell" },
              { key: "lastDone", label: "Last done" },
              { key: "month", label: "This month" },
              { key: "actions", label: "", align: "right", sortable: false },
            ]}
            rows={tasks.map((t) => ({
              key: t.id,
              sortValues: [
                t.property.name,
                t.title,
                t.dueDay,
                t.notifyTenants ? t.notifyDaysBefore : null,
                t.lastDoneOn?.toISOString() ?? null,
                doneThisMonth(t) ? "done" : "due",
                null,
              ],
              cells: [
                t.property.name,
                <span key="t" title={t.notes ?? undefined} className="font-medium">
                  {t.title}
                </span>,
                t.dueDay != null ? `${ordinal(t.dueDay)} monthly` : "—",
                t.notifyTenants ? (
                  <Badge key="n" variant="outline" className="font-medium">
                    SMS {t.notifyDaysBefore}d before
                  </Badge>
                ) : (
                  "—"
                ),
                t.lastDoneOn ? t.lastDoneOn.toLocaleDateString() : "Never",
                doneThisMonth(t) ? (
                  <Badge
                    key="m"
                    variant="outline"
                    className="border-emerald-200 bg-emerald-100 font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                  >
                    Done
                  </Badge>
                ) : (
                  <Badge
                    key="m"
                    variant="outline"
                    className="border-amber-200 bg-amber-100 font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                  >
                    Due
                  </Badge>
                ),
                <span key="a" className="inline-flex justify-end gap-1">
                  {!doneThisMonth(t) && (
                    <form action={markTaskDoneAction} className="inline">
                      <input type="hidden" name="taskId" value={t.id} />
                      <Button type="submit" variant="outline" size="xs">
                        Mark done
                      </Button>
                    </form>
                  )}
                  <FormDialog
                    trigger="Schedule"
                    triggerSize="xs"
                    title="Edit schedule"
                    description={t.title}
                  >
                    <form action={editTaskScheduleAction} className="space-y-3">
                      <input type="hidden" name="taskId" value={t.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`dueDay-${t.id}`}>
                          Day of month (blank = unscheduled)
                        </Label>
                        <Input
                          id={`dueDay-${t.id}`}
                          name="dueDay"
                          type="number"
                          min={1}
                          max={31}
                          defaultValue={t.dueDay ?? ""}
                          className="w-24"
                        />
                      </div>
                      <div className="flex items-end gap-4">
                        <label className="flex h-9 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="notifyTenants"
                            defaultChecked={t.notifyTenants}
                          />{" "}
                          Notify tenants by SMS
                        </label>
                        <div className="space-y-2">
                          <Label htmlFor={`notifyDays-${t.id}`}>
                            Days before
                          </Label>
                          <Input
                            id={`notifyDays-${t.id}`}
                            name="notifyDaysBefore"
                            type="number"
                            min={0}
                            max={14}
                            defaultValue={t.notifyDaysBefore}
                            className="w-24"
                          />
                        </div>
                      </div>
                      <Button type="submit" size="sm">
                        Save schedule
                      </Button>
                    </form>
                  </FormDialog>
                  <form action={removeTaskAction} className="inline">
                    <input type="hidden" name="taskId" value={t.id} />
                    <ConfirmSubmitButton
                      variant="ghost"
                      size="xs"
                      confirmMessage="Remove this recurring task? It disappears from this list (its history is kept)."
                    >
                      Remove
                    </ConfirmSubmitButton>
                  </form>
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
