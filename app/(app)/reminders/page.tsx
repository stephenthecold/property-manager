import Link from "next/link";
import { BellIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { formatDateTime } from "@/lib/ui/datetime";
import type {
  ReminderStatus,
  ReminderType,
} from "@/lib/generated/prisma/enums";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/status-badge";
import type { Tone } from "@/lib/ui/status-tone";

export const runtime = "nodejs";

const STATUSES: ReminderStatus[] = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "held_for_consent",
];
const TYPES: ReminderType[] = [
  "rent_due_soon",
  "rent_overdue",
  "partial_balance",
  "payment_receipt",
  "manual",
];

const STATUS_TONE: Record<ReminderStatus, Tone> = {
  delivered: "success",
  sent: "info",
  queued: "warning",
  failed: "danger",
  held_for_consent: "hold",
};

const SELECT_CLASS =
  "h-9 w-full rounded-md border px-3 text-sm capitalize";

/** Mask a phone number to its last 4 digits ("+1 555 010 0142" -> "•••• 0142"). */
function maskPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "—";
  return `•••• ${digits.slice(-4)}`;
}

function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Parse "?bulk=sent-failed-noConsent-noPhone-duplicate" into a summary line. */
function bulkSummary(raw: string): string | null {
  const parts = raw.split("-");
  if (parts.length !== 5 || parts.some((p) => !/^\d+$/.test(p))) return null;
  const [sent, failed, noConsent, noPhone, duplicate] = parts;
  return `Bulk send: ${sent} sent, ${failed} failed, ${noConsent} skipped (no consent), ${noPhone} skipped (no phone), ${duplicate} skipped (duplicate).`;
}

export default async function RemindersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("reminders.send");
  const { defaultTimezone: tz } = await getAppSettings();
  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v) ?? "";

  const statusRaw = first(sp.status).trim();
  const typeRaw = first(sp.type).trim();
  const bulkRaw = first(sp.bulk).trim();

  const status = STATUSES.includes(statusRaw as ReminderStatus)
    ? (statusRaw as ReminderStatus)
    : undefined;
  const type = TYPES.includes(typeRaw as ReminderType)
    ? (typeRaw as ReminderType)
    : undefined;
  const bulk = bulkRaw ? bulkSummary(bulkRaw) : null;

  const reminders = await prisma.reminder.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(type ? { reminderType: type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const tenantIds = [...new Set(reminders.map((r) => r.tenantId))];
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: tenantIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const tenantById = new Map(
    tenants.map((t) => [t.id, `${t.firstName} ${t.lastName}`]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reminders"
        description="SMS reminder log. Send reminders from a tenant's page. Showing the 100 most recent."
      />

      {bulk && (
        <Alert>
          <AlertDescription>{bulk}</AlertDescription>
        </Alert>
      )}

      <form
        method="GET"
        action="/reminders"
        className="grid grid-cols-2 gap-3 md:max-w-xl md:grid-cols-3 md:items-end"
      >
        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="type">Type</Label>
          <select
            id="type"
            name="type"
            defaultValue={type ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">All</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Button type="submit" variant="outline">
            Apply
          </Button>
        </div>
      </form>

      <DataTable
        emptyState={
          <EmptyState
            icon={<BellIcon />}
            title={status || type ? "No matching reminders" : "No reminders yet"}
            description={
              status || type
                ? "No reminders match this filter — try a different status or type, or clear the filter."
                : "Send a reminder from a tenant's page and it will be logged here."
            }
            action={
              status || type ? (
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href="/reminders" />}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        }
        columns={[
          { key: "created", label: "Created" },
          { key: "tenant", label: "Tenant" },
          { key: "type", label: "Type", className: "hidden sm:table-cell" },
          { key: "period", label: "Period", className: "hidden lg:table-cell" },
          {
            key: "destination",
            label: "Destination",
            sortable: false,
            className: "hidden md:table-cell",
          },
          { key: "status", label: "Status" },
          { key: "provider", label: "Provider", className: "hidden lg:table-cell" },
          { key: "message", label: "Message", sortable: false, className: "hidden xl:table-cell" },
        ]}
        rows={reminders.map((r) => ({
          key: r.id,
          sortValues: [
            r.createdAt.toISOString(),
            tenantById.get(r.tenantId) ?? "Unknown tenant",
            r.reminderType,
            r.periodKey,
            null,
            r.status,
            r.provider,
            null,
          ],
          cells: [
            formatDateTime(r.createdAt, tz),
            <Link
              key="t"
              href={`/tenants/${r.tenantId}`}
              className="font-medium hover:underline"
            >
              {tenantById.get(r.tenantId) ?? "Unknown tenant"}
            </Link>,
            <span key="ty" className="capitalize">
              {r.reminderType.replace(/_/g, " ")}
            </span>,
            r.periodKey ?? "—",
            <span key="d" className="tabular-nums">
              {maskPhone(r.destinationPhone)}
            </span>,
            <div key="s" className="space-y-0.5">
              <ToneBadge
                tone={STATUS_TONE[r.status]}
                className="capitalize"
                title={
                  r.status === "delivered" && r.deliveredAt
                    ? `Delivered ${formatDateTime(r.deliveredAt, tz)}`
                    : r.status === "failed" && r.failedReason
                      ? r.failedReason
                      : undefined
                }
              >
                {r.status.replace(/_/g, " ")}
              </ToneBadge>
              {r.status === "failed" && r.failedReason && (
                <span
                  className="block max-w-[14rem] truncate text-xs text-red-700 dark:text-red-300"
                  title={r.failedReason}
                >
                  {r.failedReason}
                </span>
              )}
            </div>,
            r.provider ?? "—",
            <span key="m" className="text-muted-foreground" title={r.messageBody}>
              {truncate(r.messageBody)}
            </span>,
          ],
        }))}
      />
    </div>
  );
}
