import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/data-table";
import { convertRequestToJobAction, setRequestStatusAction } from "./actions";

export const runtime = "nodejs";

/**
 * Staff queue for portal submissions (maintenance issues + cash pickups).
 * portal.manage gates it; module-off redirects like every module page (the
 * rows are retained and reappear when the module is re-enabled).
 */
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("portal.manage");
  const { modules } = await getAppSettings();
  if (!modules.tenantPortal) redirect("/dashboard");
  const sp = await searchParams;
  const error = (Array.isArray(sp.error) ? sp.error[0] : sp.error)?.trim();
  const showAll = (Array.isArray(sp.all) ? sp.all[0] : sp.all) === "1";

  const requests = await prisma.tenantRequest.findMany({
    where: showAll ? {} : { status: { in: ["open", "in_progress"] } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { tenant: { select: { id: true, firstName: true, lastName: true } } },
  });
  const leaseIds = [...new Set(requests.map((r) => r.leaseId).filter((x): x is string => !!x))];
  const leases = leaseIds.length
    ? await prisma.lease.findMany({
        where: { id: { in: leaseIds } },
        select: {
          id: true,
          unit: { select: { unitNumber: true, property: { select: { name: true } } } },
        },
      })
    : [];
  const leaseById = new Map(leases.map((l) => [l.id, l]));

  const statusBadge = (status: string) => (
    <Badge
      variant="outline"
      className={
        status === "open"
          ? "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
          : status === "in_progress"
            ? "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
            : status === "done"
              ? "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "text-muted-foreground"
      }
    >
      {status.replace(/_/g, " ")}
    </Badge>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tenant requests</h1>
          <p className="text-sm text-muted-foreground">
            Portal submissions: maintenance issues and cash-rent pickups.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          render={<Link href={showAll ? "/requests" : "/requests?all=1"} />}
        >
          {showAll ? "Show open only" : "Show all (incl. closed)"}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        emptyMessage={showAll ? "No requests yet." : "No open requests — all caught up."}
        columns={[
          { key: "created", label: "Submitted" },
          { key: "tenant", label: "Tenant" },
          { key: "type", label: "Type" },
          { key: "where", label: "Unit", className: "hidden md:table-cell" },
          { key: "message", label: "Message", sortable: false },
          { key: "status", label: "Status" },
          { key: "actions", label: "Actions", align: "right", sortable: false },
        ]}
        rows={requests.map((r) => {
          const lease = r.leaseId ? leaseById.get(r.leaseId) : null;
          const open = r.status === "open" || r.status === "in_progress";
          return {
            key: r.id,
            sortValues: [
              r.createdAt.toISOString(),
              `${r.tenant.lastName}, ${r.tenant.firstName}`,
              r.type,
              lease ? `${lease.unit.property.name} · ${lease.unit.unitNumber}` : "",
              null,
              r.status,
              null,
            ],
            cells: [
              r.createdAt.toLocaleDateString(),
              <Link
                key="t"
                href={`/tenants/${r.tenant.id}`}
                className="font-medium hover:underline"
              >
                {r.tenant.firstName} {r.tenant.lastName}
              </Link>,
              <span key="ty" className="capitalize">
                {r.type.replace(/_/g, " ")}
              </span>,
              lease ? `${lease.unit.property.name} · ${lease.unit.unitNumber}` : "—",
              <span key="m" className="block max-w-[20rem] truncate text-sm" title={r.message ?? ""}>
                {r.message || "—"}
              </span>,
              <span key="s">{statusBadge(r.status)}</span>,
              open ? (
                <div key="a" className="flex flex-wrap justify-end gap-2">
                  {r.type === "maintenance" &&
                    modules.maintenance &&
                    !r.maintenanceJobId && (
                      <form action={convertRequestToJobAction}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Create job
                        </Button>
                      </form>
                    )}
                  <form action={setRequestStatusAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="status" value="done" />
                    <Button type="submit" variant="outline" size="sm">
                      Mark done
                    </Button>
                  </form>
                  <form action={setRequestStatusAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="status" value="declined" />
                    <ConfirmSubmitButton
                      variant="outline"
                      size="sm"
                      confirmMessage={`Decline this ${r.type.replace(/_/g, " ")} request from ${r.tenant.firstName} ${r.tenant.lastName}? They'll see the status change in the portal.`}
                    >
                      Decline
                    </ConfirmSubmitButton>
                  </form>
                </div>
              ) : (
                <span key="a" className="text-xs text-muted-foreground">
                  {r.maintenanceJobId ? "Job created" : "—"}
                </span>
              ),
            ],
          };
        })}
      />
    </div>
  );
}
