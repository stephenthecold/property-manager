import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listNotices } from "@/lib/services/notices";
import {
  NOTICE_TYPES,
  noticeTypeLabel,
} from "@/lib/notices/templates";
import type { NoticeStatus, NoticeType } from "@/lib/generated/prisma/enums";
import {
  createNoticeAction,
  markNoticeServedAction,
  updateNoticeAction,
  voidNoticeAction,
} from "./actions";
import { BellIcon } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { FormDialog } from "@/components/app/form-dialog";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const runtime = "nodejs";

const STATUSES = ["draft", "served", "void"] as const;
const SERVE_METHODS = ["hand", "mail", "posted", "email"] as const;

function statusClass(s: NoticeStatus): string {
  if (s === "served") return "text-emerald-600 dark:text-emerald-400";
  if (s === "void") return "text-muted-foreground line-through";
  return "text-amber-600 dark:text-amber-400";
}

export default async function NoticesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("notices.manage");
  const settings = await getAppSettings();
  if (!settings.modules.notices) redirect("/dashboard");

  const sp = await searchParams;
  const first = (k: string): string => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };
  const statusRaw = first("status");
  const status = (STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as NoticeStatus)
    : undefined;
  const typeRaw = first("type");
  const type = (NOTICE_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as NoticeType)
    : undefined;

  const [notices, activeLeases] = await Promise.all([
    listNotices({ status, type }),
    prisma.lease.findMany({
      where: { status: { in: ["active", "month_to_month"] } },
      orderBy: [
        { unit: { property: { name: "asc" } } },
        { unit: { unitNumber: "asc" } },
      ],
      select: {
        id: true,
        tenant: { select: { firstName: true, lastName: true } },
        unit: { select: { unitNumber: true, property: { select: { name: true } } } },
      },
    }),
  ]);

  const leaseOptions = activeLeases.map((l) => ({
    id: l.id,
    label: `${l.unit.property.name} · ${l.unit.unitNumber} — ${l.tenant.lastName}, ${l.tenant.firstName}`,
  }));

  const typeField = (
    <div className="space-y-2">
      <Label htmlFor="nType">Type</Label>
      <select id="nType" name="type" defaultValue="late_rent" className="h-9 w-full rounded-md border px-3 text-sm">
        {NOTICE_TYPES.map((t) => (
          <option key={t} value={t}>
            {noticeTypeLabel(t)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notices"
        description="Formal landlord notices. Generate from a per-type template prefilled with the lease details, edit while it's a draft, then mark served and print. The text is snapshotted. The default templates are starting points — review them against your local requirements before serving."
        actions={
          <FormDialog
            trigger="Create notice"
            triggerVariant="default"
            title="Create notice"
            description="Leave subject/body blank to use the type's default template (filled with the lease's details). You can edit the draft afterward."
            action={createNoticeAction}
            submitLabel="Create draft"
            wide
          >
            <div className="space-y-2">
              <Label htmlFor="nLease">Lease</Label>
              <select id="nLease" name="leaseId" required defaultValue="" className="h-9 w-full rounded-md border px-3 text-sm">
                <option value="" disabled>
                  Select a lease…
                </option>
                {leaseOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {typeField}
            <div className="space-y-2">
              <Label htmlFor="nEff">Effective date (pay-by / move-out / increase date)</Label>
              <Input id="nEff" name="effectiveDate" type="date" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nSubject">Subject (optional — blank uses the template)</Label>
              <Input id="nSubject" name="subject" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nBody">Body (optional — blank uses the template)</Label>
              <Textarea id="nBody" name="body" rows={6} />
            </div>
          </FormDialog>
        }
      />

      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="fStatus">Status</Label>
          <select id="fStatus" name="status" defaultValue={status ?? ""} className="h-9 w-36 rounded-md border px-3 text-sm capitalize">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="fType">Type</Label>
          <select id="fType" name="type" defaultValue={type ?? ""} className="h-9 w-56 rounded-md border px-3 text-sm">
            <option value="">All types</option>
            {NOTICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {noticeTypeLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm">
          Apply
        </Button>
        {(status || type) && (
          <Button variant="ghost" size="sm" render={<Link href="/notices" />}>
            Clear
          </Button>
        )}
      </form>

      <DataTable
        emptyState={
          <EmptyState
            icon={<BellIcon />}
            title={status || type ? "No matching notices" : "No notices yet"}
            description={
              status || type
                ? "Try a different status or type — or clear the filters."
                : "Create a notice from a per-type template prefilled with the lease details."
            }
            action={
              status || type ? (
                <Button variant="outline" size="sm" render={<Link href="/notices" />}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        }
        columns={[
          { key: "date", label: "Created" },
          { key: "tenant", label: "Tenant" },
          { key: "type", label: "Type" },
          { key: "effective", label: "Effective", className: "hidden md:table-cell" },
          { key: "status", label: "Status" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={notices.map((n) => ({
          key: n.id,
          sortValues: [
            n.createdAt.toISOString(),
            `${n.lease.tenant.lastName}, ${n.lease.tenant.firstName}`,
            noticeTypeLabel(n.type),
            n.effectiveDate ? n.effectiveDate.toISOString() : "",
            n.status,
            null,
          ],
          cells: [
            n.createdAt.toLocaleDateString("en-US"),
            <div key="t">
              <Link
                href={`/tenants/${n.lease.tenantId}`}
                className="font-medium hover:underline"
              >
                {n.lease.tenant.firstName} {n.lease.tenant.lastName}
              </Link>
              <Link
                href={`/leases/${n.lease.id}/agreement`}
                className="block text-xs text-muted-foreground hover:underline"
              >
                {n.lease.unit.property.name} · {n.lease.unit.unitNumber}
              </Link>
            </div>,
            noticeTypeLabel(n.type),
            n.effectiveDate ? n.effectiveDate.toLocaleDateString("en-US") : "—",
            <span key="s" className={`capitalize ${statusClass(n.status)}`}>
              {n.status}
              {n.status === "served" && n.servedMethod ? ` (${n.servedMethod})` : ""}
            </span>,
            <div key="a" className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" size="xs" render={<Link href={`/notices/${n.id}`} target="_blank" />}>
                Print
              </Button>
              {n.status === "draft" && (
                <FormDialog
                  trigger="Edit"
                  triggerSize="xs"
                  title="Edit notice"
                  action={updateNoticeAction}
                  submitLabel="Save"
                  wide
                >
                  <input type="hidden" name="noticeId" value={n.id} />
                  <div className="space-y-2">
                    <Label htmlFor={`es-${n.id}`}>Subject</Label>
                    <Input id={`es-${n.id}`} name="subject" defaultValue={n.subject} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`ee-${n.id}`}>Effective date</Label>
                    <Input
                      id={`ee-${n.id}`}
                      name="effectiveDate"
                      type="date"
                      defaultValue={n.effectiveDate ? n.effectiveDate.toISOString().slice(0, 10) : ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`eb-${n.id}`}>Body</Label>
                    <Textarea id={`eb-${n.id}`} name="body" rows={10} defaultValue={n.body} required />
                  </div>
                </FormDialog>
              )}
              {n.status !== "void" && (
                <form action={markNoticeServedAction} className="flex items-center gap-1">
                  <input type="hidden" name="noticeId" value={n.id} />
                  <select name="servedMethod" defaultValue="hand" className="h-7 rounded border bg-card px-1 text-xs dark:bg-input/30">
                    {SERVE_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" variant="outline" size="xs">
                    {n.status === "served" ? "Re-serve" : "Mark served"}
                  </Button>
                </form>
              )}
              {n.status !== "void" && (
                <form action={voidNoticeAction}>
                  <input type="hidden" name="noticeId" value={n.id} />
                  <ConfirmSubmitButton
                    variant="outline"
                    size="xs"
                    confirmMessage="Void this notice? It will be kept but marked void."
                  >
                    Void
                  </ConfirmSubmitButton>
                </form>
              )}
            </div>,
          ],
        }))}
      />
    </div>
  );
}
