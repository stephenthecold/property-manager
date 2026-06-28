import Link from "next/link";
import { DateTime } from "luxon";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listReportSchedules } from "@/lib/services/report-schedules";
import { REPORT_DEFS, defaultReportTimezone } from "@/lib/services/report-registry";
import {
  createReportScheduleAction,
  deleteReportScheduleAction,
} from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const runtime = "nodejs";
export const metadata = { title: "Scheduled reports" };

const SELECT_CLASS = "h-9 w-full rounded-md border px-3 text-sm";

const FORMAT_LABEL: Record<string, string> = {
  csv: "CSV",
  pdf: "PDF",
  xlsx: "Excel",
};

function ScheduleFields() {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="reportType">Report</Label>
        <select id="reportType" name="reportType" required className={SELECT_CLASS}>
          {Object.entries(REPORT_DEFS).map(([slug, def]) => (
            <option key={slug} value={slug}>
              {def.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="format">Format</Label>
          <select id="format" name="format" defaultValue="pdf" className={SELECT_CLASS}>
            <option value="csv">CSV</option>
            <option value="pdf">PDF</option>
            <option value="xlsx">Excel</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cadence">Cadence</Label>
          <select id="cadence" name="cadence" defaultValue="weekly" className={SELECT_CLASS}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="recipientEmails">Recipients</Label>
        <Input
          id="recipientEmails"
          name="recipientEmails"
          required
          placeholder="alice@example.com, bob@example.com"
        />
        <p className="text-xs text-muted-foreground">
          One or more email addresses, separated by commas.
        </p>
      </div>
    </>
  );
}

export default async function ReportSchedulesPage() {
  await requireCapability("reports.schedule");
  const [settings, schedules] = await Promise.all([
    getAppSettings(),
    listReportSchedules(),
  ]);
  const tz = defaultReportTimezone();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Scheduled report delivery</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Email a report automatically on a weekly or monthly cadence. The
            background worker renders the report in the chosen format (CSV, PDF,
            or Excel) and emails it to the recipients you list. Weekly schedules
            send once per calendar week; monthly once per calendar month.
          </p>
        </div>
        <FormDialog
          trigger="Add schedule"
          triggerVariant="default"
          title="Schedule report delivery"
          action={createReportScheduleAction}
          submitLabel="Create schedule"
        >
          <ScheduleFields />
        </FormDialog>
      </div>

      {!settings.emailEnabled && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Email is currently disabled, so scheduled reports will not be sent.
          Enable and configure it under{" "}
          <Link href="/settings/messaging" className="underline">
            Settings → Messaging
          </Link>
          .
        </div>
      )}

      <DataTable
        emptyMessage="No scheduled deliveries yet. Add one to email a report on a cadence."
        columns={[
          { key: "report", label: "Report" },
          { key: "format", label: "Format" },
          { key: "cadence", label: "Cadence" },
          { key: "recipients", label: "Recipients" },
          { key: "lastSent", label: "Last sent", className: "hidden sm:table-cell" },
          { key: "actions", label: "", align: "right", sortable: false },
        ]}
        rows={schedules.map((s) => ({
          key: s.id,
          sortValues: [
            s.reportTitle,
            s.format,
            s.cadence,
            s.recipientEmails,
            s.lastSentAt ? s.lastSentAt.toISOString() : null,
            null,
          ],
          cells: [
            s.reportTitle,
            FORMAT_LABEL[s.format] ?? s.format,
            <span key="c" className="capitalize">
              {s.cadence}
            </span>,
            <span key="r" className="text-sm">
              {s.recipientEmails}
            </span>,
            s.lastSentAt
              ? DateTime.fromJSDate(s.lastSentAt, { zone: tz }).toFormat(
                  "yyyy-MM-dd HH:mm",
                )
              : "—",
            <form key="d" action={deleteReportScheduleAction} className="flex justify-end">
              <input type="hidden" name="scheduleId" value={s.id} />
              <ConfirmSubmitButton confirmMessage="Delete this scheduled delivery?">
                Delete
              </ConfirmSubmitButton>
            </form>,
          ],
        }))}
      />
    </div>
  );
}
