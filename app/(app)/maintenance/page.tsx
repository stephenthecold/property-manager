import Link from "next/link";
import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { CalendarClockIcon, WrenchIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { formatCurrency } from "@/lib/money";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  addJobAttachmentAction,
  addJobUpdateAction,
  assignJobAction,
  completeJobAction,
  createJobAction,
  createTaskAction,
  deleteJobAction,
  editTaskScheduleAction,
  markTaskDoneAction,
  removeTaskAction,
  reopenJobAction,
  setJobAssetAction,
  setJobPriorityAction,
  setJobStatusAction,
  uncancelJobAction,
} from "./actions";
import { getSignedUrlForDoc } from "@/lib/services/documents";
import { listActiveVendors } from "@/lib/services/vendors";
import {
  MAINTENANCE_PRIORITIES,
  priorityLabel,
} from "@/lib/maintenance/priority";
import {
  OPEN_STATUSES,
  isOpenStatus,
  MAINTENANCE_STATUSES,
  statusBadgeClass,
  statusLabel,
} from "@/lib/maintenance/status";
import { slaState } from "@/lib/maintenance/sla";
import { formatDate, formatDateTime } from "@/lib/ui/datetime";
import type { MaintenancePriority } from "@/lib/generated/prisma/enums";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/status-badge";
import type { Tone } from "@/lib/ui/status-tone";
import { FormDialog } from "@/components/app/form-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const runtime = "nodejs";

/** Priority -> badge tone, drawn from the shared tone source. */
const PRIORITY_TONE: Record<MaintenancePriority, Tone> = {
  urgent: "danger",
  high: "warning",
  normal: "info",
  low: "neutral",
};

/**
 * Small overdue / due-soon chip next to a due date. Renders nothing for
 * on-track or terminal jobs (state "on_track"/"none").
 */
function SlaChip({
  state,
  daysUntilDue,
}: {
  state: "overdue" | "due_soon" | "on_track" | "none";
  daysUntilDue: number | null;
}) {
  if (state === "overdue") {
    const days = daysUntilDue != null ? Math.abs(daysUntilDue) : 0;
    return (
      <ToneBadge tone="danger">Overdue {days}d</ToneBadge>
    );
  }
  if (state === "due_soon") {
    const label =
      daysUntilDue === 0
        ? "Due today"
        : `Due in ${daysUntilDue}d`;
    return (
      <ToneBadge tone="warning">{label}</ToneBadge>
    );
  }
  return null;
}

/** "2026-06" -> "Jun 2026" (the property-tz month a task was done for). */
function monthLabel(periodKey: string): string {
  const dt = DateTime.fromFormat(periodKey, "yyyy-MM");
  return dt.isValid ? dt.toFormat("MMM yyyy") : periodKey;
}

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
  const tz = settings.defaultTimezone;

  const sp = await searchParams;
  const first = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const error = first("error") || null;
  const filterPropertyId = first("propertyId") || undefined;
  // "open" = any non-terminal state; otherwise a single lifecycle status.
  const rawStatus = first("status");
  const filterStatus =
    rawStatus === "open" || MAINTENANCE_STATUSES.includes(rawStatus as never)
      ? rawStatus
      : undefined;

  const jobWhere: Prisma.MaintenanceJobWhereInput = {};
  if (filterPropertyId) jobWhere.propertyId = filterPropertyId;
  if (filterStatus === "open") {
    jobWhere.status = { in: OPEN_STATUSES };
  } else if (filterStatus) {
    jobWhere.status = filterStatus as Prisma.MaintenanceJobWhereInput["status"];
  }

  const [jobs, tasks, properties, units, vendors, staff, assets] = await Promise.all([
    prisma.maintenanceJob.findMany({
      where: jobWhere,
      orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
      take: 300,
      include: {
        property: { select: { name: true, timezone: true, currency: true } },
        unit: { select: { unitNumber: true } },
        vendor: { select: { name: true } },
        asset: { select: { id: true, name: true } },
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
    // Active staff for the assignee picker; loose ref so no relation is needed.
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: [{ name: "asc" }, { email: "asc" }],
      select: { id: true, name: true, email: true },
    }),
    // Active assets for the optional job<->asset picker; scoped per row below.
    prisma.asset.findMany({
      where: { active: true },
      orderBy: [{ property: { name: "asc" } }, { name: "asc" }],
      select: { id: true, name: true, propertyId: true, unitId: true },
    }),
  ]);

  // Resolve an assignee's display label by id (covers historical/inactive ids).
  const staffById = new Map(staff.map((u) => [u.id, u.name?.trim() || u.email]));
  // Lookup maps for labeling an asset's property/unit context in the pickers.
  const propertiesById = new Map(properties.map((p) => [p.id, p.name]));
  const unitsById = new Map(units.map((u) => [u.id, u]));

  /**
   * Assets a job may link to: same property, and either property-wide
   * (asset.unitId == null) or the job's exact unit. Mirrors the server-side
   * validateJobAsset check so the picker only offers writable options.
   */
  const assetsForJob = (propertyId: string, unitId: string | null) =>
    assets.filter(
      (a) => a.propertyId === propertyId && (a.unitId == null || a.unitId === unitId),
    );

  // Attachments (loose ref) for the visible jobs, with signed download URLs.
  const jobIds = jobs.map((j) => j.id);
  const attachmentDocs = jobIds.length
    ? await prisma.uploadedDocument.findMany({
        where: { maintenanceJobId: { in: jobIds } },
        orderBy: { createdAt: "desc" },
        select: { id: true, fileName: true, fileUrl: true, maintenanceJobId: true },
      })
    : [];
  const attachmentsByJob = new Map<
    string,
    { id: string; fileName: string; url: string | null }[]
  >();
  // Sign the already-loaded rows in parallel (no per-attachment DB re-fetch),
  // then group in the original createdAt-desc order.
  const attachmentUrls = await Promise.all(
    attachmentDocs.map((d) => getSignedUrlForDoc(d)),
  );
  attachmentDocs.forEach((d, i) => {
    if (!d.maintenanceJobId) return;
    const arr = attachmentsByJob.get(d.maintenanceJobId) ?? [];
    arr.push({ id: d.id, fileName: d.fileName ?? "file", url: attachmentUrls[i] });
    attachmentsByJob.set(d.maintenanceJobId, arr);
  });

  // Recent completion history for the visible tasks (one batched query). The
  // dialog shows the most recent 12 per task; `total` keeps the trigger count
  // honest even when a long-running task has more than 12 logged months.
  const taskIds = tasks.map((t) => t.id);
  const executions = taskIds.length
    ? await prisma.recurringTaskExecution.findMany({
        where: { taskId: { in: taskIds } },
        orderBy: { doneOn: "desc" },
        select: {
          id: true,
          taskId: true,
          periodKey: true,
          doneOn: true,
          doneByUserId: true,
        },
      })
    : [];
  type TaskHistory = { rows: typeof executions; total: number };
  const historyByTask = new Map<string, TaskHistory>();
  for (const e of executions) {
    const h = historyByTask.get(e.taskId) ?? { rows: [], total: 0 };
    if (h.rows.length < 12) h.rows.push(e);
    h.total += 1;
    historyByTask.set(e.taskId, h);
  }

  const now = new Date();
  const doneThisMonth = (t: (typeof tasks)[number]) =>
    !!t.lastDoneOn &&
    DateTime.fromJSDate(t.lastDoneOn, { zone: t.property.timezone }).hasSame(
      DateTime.fromJSDate(now, { zone: t.property.timezone }),
      "month",
    );

  const openJobs = jobs.filter((j) => isOpenStatus(j.status)).length;
  const filtering = Boolean(filterPropertyId || filterStatus);

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <PageHeader
        title="Maintenance"
        description={
          <>
            {openJobs} open job{openJobs === 1 ? "" : "s"} · completed jobs with a
            cost are logged to Financials automatically.
          </>
        }
        actions={
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
            {assets.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="mjAsset">Asset (optional)</Label>
                <select
                  id="mjAsset"
                  name="assetId"
                  className="h-9 w-full rounded-md border px-3 text-sm"
                >
                  <option value="">— none —</option>
                  {assets.map((a) => {
                    const where = unitsById.get(a.unitId ?? "");
                    const ctx = where
                      ? `${where.property.name} · ${where.unitNumber}`
                      : propertiesById.get(a.propertyId) ?? "";
                    return (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {ctx ? ` — ${ctx}` : ""}
                      </option>
                    );
                  })}
                </select>
                <p className="text-xs text-muted-foreground">
                  Must match the job&apos;s property/unit; pick the equipment this
                  job is about.
                </p>
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
        }
      />

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
                <option value="open">Open (any)</option>
                {MAINTENANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
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
            emptyState={
              <EmptyState
                icon={<WrenchIcon />}
                title={filtering ? "No matching jobs" : "No maintenance jobs yet"}
                description={
                  filtering
                    ? "Try a different property or status — or clear the filters."
                    : "Add a maintenance job to track repairs, vendors, and costs."
                }
                action={
                  filtering ? (
                    <Button variant="outline" size="sm" render={<Link href="/maintenance" />}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            }
            columns={[
              { key: "created", label: "Created", className: "hidden md:table-cell" },
              { key: "property", label: "Property", className: "hidden sm:table-cell" },
              { key: "unit", label: "Unit" },
              { key: "title", label: "Job" },
              { key: "priority", label: "Priority" },
              { key: "assignee", label: "Assignee", className: "hidden md:table-cell" },
              { key: "asset", label: "Asset", className: "hidden lg:table-cell" },
              { key: "due", label: "Due" },
              { key: "status", label: "Status" },
              { key: "notes", label: "Notes", align: "right", sortable: false, className: "hidden sm:table-cell" },
              { key: "files", label: "Files", align: "right", sortable: false, className: "hidden md:table-cell" },
              { key: "cost", label: "Cost", align: "right", numeric: true, className: "hidden lg:table-cell" },
              { key: "actions", label: "", align: "right", sortable: false },
            ]}
            rows={jobs.map((j) => {
              const sla = slaState({ status: j.status, dueDate: j.dueDate, now });
              const overdue = sla.state === "overdue";
              const assigneeName = j.assignedToUserId
                ? staffById.get(j.assignedToUserId) ?? "Former staff"
                : null;
              return {
                key: j.id,
                sortValues: [
                  j.createdAt.toISOString(),
                  j.property.name,
                  j.unit?.unitNumber ?? null,
                  j.title,
                  j.priority,
                  assigneeName,
                  j.asset?.name ?? null,
                  j.dueDate?.toISOString() ?? null,
                  j.status,
                  j.updates.length,
                  (attachmentsByJob.get(j.id) ?? []).length,
                  j.costCents != null ? String(j.costCents) : null,
                  null,
                ],
                cells: [
                  formatDate(j.createdAt, tz),
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
                    <ToneBadge tone={PRIORITY_TONE[j.priority]} className="capitalize">
                      {priorityLabel(j.priority)}
                    </ToneBadge>
                    <FormDialog
                      trigger="Edit"
                      triggerVariant="outline"
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
                  <span key="asg" className="inline-flex items-center gap-1">
                    <span className={assigneeName ? "text-sm" : "text-sm text-muted-foreground"}>
                      {assigneeName ?? "Unassigned"}
                    </span>
                    {isOpenStatus(j.status) && (
                      <FormDialog
                        trigger="Assign"
                        triggerVariant="outline"
                        triggerSize="xs"
                        title="Assign job"
                        description={j.title}
                        action={assignJobAction}
                        submitLabel="Save assignee"
                      >
                        <input type="hidden" name="jobId" value={j.id} />
                        <div className="space-y-2">
                          <Label htmlFor={`asg-${j.id}`}>Assignee</Label>
                          <select
                            id={`asg-${j.id}`}
                            name="assignedToUserId"
                            defaultValue={j.assignedToUserId ?? ""}
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
                      </FormDialog>
                    )}
                  </span>,
                  (() => {
                    // In-scope active assets, plus the job's CURRENTLY-linked
                    // asset even if it has since been deactivated — otherwise the
                    // select would default to "— none —" and saving would
                    // silently clear the link.
                    const scoped = assetsForJob(j.propertyId, j.unitId);
                    const options =
                      j.asset && !scoped.some((a) => a.id === j.asset!.id)
                        ? [
                            {
                              id: j.asset.id,
                              name: j.asset.name,
                              propertyId: j.propertyId,
                              unitId: j.unitId,
                            },
                            ...scoped,
                          ]
                        : scoped;
                    return (
                      <span key="asset" className="inline-flex items-center gap-1">
                        {j.asset ? (
                          <Link
                            href="/assets"
                            className="text-sm hover:underline"
                            title="View in the asset registry"
                          >
                            {j.asset.name}
                          </Link>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                        {isOpenStatus(j.status) && (options.length > 0 || j.asset) && (
                          <FormDialog
                            trigger={j.asset ? "Change" : "Link"}
                            triggerVariant="outline"
                            triggerSize="xs"
                            title="Link an asset"
                            description={j.title}
                            action={setJobAssetAction}
                            submitLabel="Save asset"
                          >
                            <input type="hidden" name="jobId" value={j.id} />
                            <div className="space-y-2">
                              <Label htmlFor={`asset-${j.id}`}>Asset</Label>
                              <select
                                id={`asset-${j.id}`}
                                name="assetId"
                                defaultValue={j.assetId ?? ""}
                                className="h-9 w-full rounded-md border px-3 text-sm"
                              >
                                <option value="">— none —</option>
                                {options.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                    {a.unitId == null ? " (property-wide)" : ""}
                                  </option>
                                ))}
                              </select>
                              <p className="text-xs text-muted-foreground">
                                Only assets in this job&apos;s property/unit are
                                shown.
                              </p>
                            </div>
                          </FormDialog>
                        )}
                      </span>
                    );
                  })(),
                  j.dueDate ? (
                    <span key="due" className="inline-flex items-center gap-1">
                      <span
                        className={overdue ? "font-medium text-red-600 dark:text-red-400" : undefined}
                      >
                        {j.dueDate.toLocaleDateString("en-US", { timeZone: "UTC" })}
                      </span>
                      <SlaChip state={sla.state} daysUntilDue={sla.daysUntilDue} />
                    </span>
                  ) : (
                    "—"
                  ),
                  <span key="s" className="inline-flex items-center gap-1">
                    <Badge
                      variant="outline"
                      className={`font-medium ${statusBadgeClass(j.status)}`}
                    >
                      {statusLabel(j.status)}
                    </Badge>
                    {isOpenStatus(j.status) && (
                      <FormDialog
                        trigger="Change"
                        triggerVariant="outline"
                        triggerSize="xs"
                        title="Change status"
                        description={j.title}
                        action={setJobStatusAction}
                        submitLabel="Save status"
                      >
                        <input type="hidden" name="jobId" value={j.id} />
                        <div className="space-y-2">
                          <Label htmlFor={`st-${j.id}`}>Status</Label>
                          <select
                            id={`st-${j.id}`}
                            name="status"
                            defaultValue={j.status}
                            className="h-9 w-full rounded-md border px-3 text-sm"
                          >
                            {OPEN_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {statusLabel(s)}
                              </option>
                            ))}
                            <option value="canceled">{statusLabel("canceled")}</option>
                          </select>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Use “Complete” to close a job with a cost.
                        </p>
                      </FormDialog>
                    )}
                  </span>,
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
                              {formatDateTime(u.createdAt, tz)}
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
                  isOpenStatus(j.status) ? (
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
                          variant="destructive"
                          size="xs"
                          confirmMessage="Delete this maintenance job? It is removed permanently and cannot be recovered."
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </form>
                    </span>
                  ) : j.status === "completed" ? (
                    <form key="a" action={reopenJobAction} className="inline">
                      <input type="hidden" name="jobId" value={j.id} />
                      <Button type="submit" variant="outline" size="xs">
                        Reopen
                      </Button>
                    </form>
                  ) : (
                    // Canceled: reopen back to pending, or delete (it's not history).
                    <span key="a" className="inline-flex justify-end gap-1">
                      <form action={uncancelJobAction} className="inline">
                        <input type="hidden" name="jobId" value={j.id} />
                        <Button type="submit" variant="outline" size="xs">
                          Reopen
                        </Button>
                      </form>
                      <form action={deleteJobAction} className="inline">
                        <input type="hidden" name="jobId" value={j.id} />
                        <ConfirmSubmitButton
                          variant="destructive"
                          size="xs"
                          confirmMessage="Delete this maintenance job? It is removed permanently and cannot be recovered."
                        >
                          Delete
                        </ConfirmSubmitButton>
                      </form>
                    </span>
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
            emptyState={
              <EmptyState
                icon={<CalendarClockIcon />}
                title="No monthly tasks yet"
                description="Add recurring upkeep like mowing or pest spraying to keep it on schedule."
              />
            }
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
                  <ToneBadge key="m" tone="success">
                    Done
                  </ToneBadge>
                ) : (
                  <ToneBadge key="m" tone="warning">
                    Due
                  </ToneBadge>
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
                  {(() => {
                    const history = historyByTask.get(t.id) ?? {
                      rows: [],
                      total: 0,
                    };
                    return (
                      <FormDialog
                        trigger={`History (${history.total})`}
                        triggerVariant="ghost"
                        triggerSize="xs"
                        title="Completion history"
                        description={t.title}
                        staticContent
                      >
                        {history.rows.length > 0 ? (
                          <>
                            <ul className="max-h-72 space-y-2 overflow-y-auto text-sm">
                              {history.rows.map((e) => {
                                const who = e.doneByUserId
                                  ? staffById.get(e.doneByUserId) ??
                                    "Former staff"
                                  : null;
                                // Render the completion DATE in the property
                                // timezone so it agrees with the month label.
                                const doneLabel = DateTime.fromJSDate(e.doneOn, {
                                  zone: t.property.timezone,
                                }).toLocaleString(DateTime.DATE_MED);
                                return (
                                  <li key={e.id} className="rounded-md border p-2">
                                    <div className="font-medium">
                                      {monthLabel(e.periodKey)}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-foreground">
                                      Done {doneLabel}
                                      {who ? ` · ${who}` : ""}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                            {history.total > history.rows.length && (
                              <p className="text-xs text-muted-foreground">
                                Showing the most recent {history.rows.length} of{" "}
                                {history.total}.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            No completions logged yet. “Mark done” records each
                            month here.
                          </p>
                        )}
                      </FormDialog>
                    );
                  })()}
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
                      variant="destructive"
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
