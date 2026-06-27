import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listApplications } from "@/lib/services/applications";
import { DataTable } from "@/components/app/data-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToneBadge } from "@/components/status-badge";
import type { Tone } from "@/lib/ui/status-tone";
import { SendLinkForm } from "./applications-forms";

export const runtime = "nodejs";

const STATUS_TONE: Record<string, Tone> = {
  submitted: "info",
  reviewing: "warning",
  approved: "success",
  declined: "danger",
  withdrawn: "neutral",
};

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
                <ToneBadge
                  key="s"
                  tone={STATUS_TONE[a.status] ?? "neutral"}
                  className="capitalize"
                >
                  {a.status}
                </ToneBadge>,
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
