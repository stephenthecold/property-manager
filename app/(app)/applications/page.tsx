import Link from "next/link";
import { redirect } from "next/navigation";
import { ClipboardListIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { listApplications } from "@/lib/services/applications";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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

const OPEN_STATUSES = ["submitted", "reviewing"] as const;

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("applications.view");
  const { modules } = await getAppSettings();
  if (!modules.applications) redirect("/dashboard");

  const sp = await searchParams;
  const first = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  // Open by default (submitted + reviewing); approved/declined/withdrawn are
  // hidden until you switch the view to "all".
  const view = first(sp.view) === "all" ? "all" : "open";

  // Counts are independent of the view so the header stays truthful in both.
  const [apps, total, open] = await Promise.all([
    listApplications({ statuses: view === "open" ? [...OPEN_STATUSES] : undefined }),
    prisma.rentalApplication.count(),
    prisma.rentalApplication.count({ where: { status: { in: [...OPEN_STATUSES] } } }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rental applications"
        description={
          <>
            {total} total · {open} awaiting review. The public form lives at{" "}
            <span className="font-mono">/apply</span>.
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="view">Show</Label>
              <select
                id="view"
                name="view"
                defaultValue={view}
                className="h-9 w-36 rounded-md border px-3 text-sm"
              >
                <option value="open">Open</option>
                <option value="all">All</option>
              </select>
            </div>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {view !== "open" && (
              <Button variant="ghost" size="sm" render={<Link href="/applications" />}>
                Clear
              </Button>
            )}
          </form>

          <DataTable
            emptyState={
              <EmptyState
                icon={<ClipboardListIcon />}
                title={view === "open" ? "No open applications" : "No applications yet"}
                description={
                  view === "open"
                    ? "Submitted and reviewing applications show here. Switch Show to “All” to include approved, declined, and withdrawn."
                    : "Submissions from the public apply form show up here. Share the apply link below to get started."
                }
                action={
                  view === "open" ? (
                    <Button variant="outline" size="sm" render={<Link href="/applications?view=all" />}>
                      Show all
                    </Button>
                  ) : undefined
                }
              />
            }
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
