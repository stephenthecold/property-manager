import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { formatCurrency } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  completeJobAction,
  createJobAction,
  createTaskAction,
  deleteJobAction,
  editTaskScheduleAction,
  markTaskDoneAction,
  removeTaskAction,
  reopenJobAction,
} from "./actions";
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

  const [jobs, tasks, properties, units] = await Promise.all([
    prisma.maintenanceJob.findMany({
      where: jobWhere,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 300,
      include: {
        property: { select: { name: true, timezone: true, currency: true } },
        unit: { select: { unitNumber: true } },
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
  ]);

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
              { key: "due", label: "Due" },
              { key: "status", label: "Status" },
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
                  j.dueDate?.toISOString() ?? null,
                  j.status,
                  j.costCents != null ? String(j.costCents) : null,
                  null,
                ],
                cells: [
                  j.createdAt.toLocaleDateString(),
                  j.property.name,
                  j.unit?.unitNumber ?? "—",
                  <span key="t" title={j.details ?? undefined} className="font-medium">
                    {j.title}
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
                      >
                        <form action={completeJobAction} className="space-y-3">
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
                          <Button type="submit" size="sm">
                            Mark completed
                          </Button>
                        </form>
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
