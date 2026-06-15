import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listApplications } from "@/lib/services/applications";
import { DataTable } from "@/components/app/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SendLinkForm } from "./applications-forms";

export const runtime = "nodejs";

const STATUS_TONE: Record<string, string> = {
  submitted: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  reviewing: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  declined: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300",
  withdrawn: "bg-muted text-muted-foreground",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_TONE[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

export default async function ApplicationsPage() {
  await requireCapability("applications.view");
  const { modules } = await getAppSettings();
  if (!modules.applications) redirect("/dashboard");

  const apps = await listApplications();
  const open = apps.filter(
    (a) => a.status === "submitted" || a.status === "reviewing",
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rental applications</h1>
        <p className="text-sm text-muted-foreground">
          {apps.length} total · {open} awaiting review. The public form lives at{" "}
          <span className="font-mono">/apply</span>.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submissions</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage="No applications yet."
            columns={[
              { key: "name", label: "Applicant" },
              { key: "contact", label: "Contact", className: "hidden sm:table-cell" },
              { key: "interest", label: "Interest", className: "hidden md:table-cell" },
              { key: "status", label: "Status" },
              { key: "submitted", label: "Submitted", align: "right" },
            ]}
            rows={apps.map((a) => ({
              key: a.id,
              sortValues: [
                `${a.lastName} ${a.firstName}`,
                a.email ?? a.phone ?? "",
                a.unit?.unitNumber ?? a.property?.name ?? "",
                a.status,
                a.createdAt.toISOString(),
              ],
              cells: [
                <Link
                  key="n"
                  href={`/applications/${a.id}`}
                  className="font-medium hover:underline"
                >
                  {a.firstName} {a.lastName}
                </Link>,
                <span key="c" className="text-muted-foreground">
                  {a.email ?? a.phone ?? "—"}
                </span>,
                <span key="i" className="text-muted-foreground">
                  {a.unit
                    ? `${a.property?.name ?? ""} · Unit ${a.unit.unitNumber}`
                    : (a.property?.name ?? "—")}
                </span>,
                <StatusBadge key="s" status={a.status} />,
                <span key="d" className="tabular-nums text-muted-foreground">
                  {a.createdAt.toLocaleDateString()}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send an apply link</CardTitle>
        </CardHeader>
        <CardContent>
          <SendLinkForm />
        </CardContent>
      </Card>
    </div>
  );
}
