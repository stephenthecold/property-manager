import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxIcon } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { getSignedUrlForDoc } from "@/lib/services/documents";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/status-badge";
import type { Tone } from "@/lib/ui/status-tone";
import { convertRequestToJobAction, setRequestStatusAction } from "./actions";

export const runtime = "nodejs";

const REQUEST_TONE: Record<string, Tone> = {
  open: "warning",
  in_progress: "info",
  done: "success",
};

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
          unit: {
            select: {
              id: true,
              unitNumber: true,
              property: { select: { id: true, name: true } },
            },
          },
        },
      })
    : [];
  const leaseById = new Map(leases.map((l) => [l.id, l]));

  // Tenant-attached photos for the visible requests (bounded by photo count,
  // not request count). Signed URLs are best-effort — a storage outage just
  // hides the thumbnails.
  const photoDocs = requests.length
    ? await prisma.uploadedDocument.findMany({
        where: {
          tenantRequestId: { in: requests.map((r) => r.id) },
          fileType: { startsWith: "image/" },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];
  const photosByRequest = new Map<string, { id: string; url: string | null; fileName: string | null }[]>();
  // Sign already-loaded rows in parallel (no per-photo DB re-fetch), then group
  // in the original createdAt-asc order.
  const photoUrls = await Promise.all(photoDocs.map((d) => getSignedUrlForDoc(d)));
  photoDocs.forEach((d, i) => {
    if (!d.tenantRequestId) return;
    const list = photosByRequest.get(d.tenantRequestId) ?? [];
    list.push({ id: d.id, url: photoUrls[i], fileName: d.fileName });
    photosByRequest.set(d.tenantRequestId, list);
  });

  const statusBadge = (status: string) => (
    <ToneBadge tone={REQUEST_TONE[status] ?? "neutral"}>
      {status.replace(/_/g, " ")}
    </ToneBadge>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tenant requests"
        description="Portal submissions: maintenance issues and cash-rent pickups."
        actions={
          <Button
            variant="outline"
            size="sm"
            render={<Link href={showAll ? "/requests" : "/requests?all=1"} />}
          >
            {showAll ? "Show open only" : "Show all (incl. closed)"}
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTable
        emptyState={
          <EmptyState
            icon={<InboxIcon />}
            title={showAll ? "No requests yet" : "No open requests"}
            description={
              showAll
                ? "Tenant maintenance issues and cash-rent pickups submitted from the portal land here."
                : "You're all caught up — no open tenant requests right now."
            }
            action={
              showAll ? undefined : (
                <Button variant="outline" size="sm" render={<Link href="/requests?all=1" />}>
                  Show all (incl. closed)
                </Button>
              )
            }
          />
        }
        columns={[
          { key: "created", label: "Submitted" },
          { key: "tenant", label: "Tenant" },
          { key: "type", label: "Type" },
          { key: "where", label: "Unit", className: "hidden md:table-cell" },
          { key: "message", label: "Message", sortable: false },
          { key: "photos", label: "Photos", sortable: false, className: "hidden lg:table-cell" },
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
              lease ? (
                <span key="w">
                  {lease.unit.property.name} ·{" "}
                  <Link
                    href={`/units/${lease.unit.id}`}
                    className="hover:underline"
                  >
                    {lease.unit.unitNumber}
                  </Link>
                </span>
              ) : (
                "—"
              ),
              <span key="m" className="block max-w-[20rem] truncate text-sm" title={r.message ?? ""}>
                {r.message || "—"}
              </span>,
              (() => {
                const ph = photosByRequest.get(r.id) ?? [];
                if (ph.length === 0)
                  return (
                    <span key="ph" className="text-xs text-muted-foreground">
                      —
                    </span>
                  );
                return (
                  <div key="ph" className="flex flex-wrap gap-1">
                    {ph.slice(0, 4).map((p) =>
                      p.url ? (
                        <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
                          <img
                            src={p.url}
                            alt={p.fileName ?? "Tenant photo"}
                            className="h-10 w-10 rounded border object-cover hover:opacity-90"
                          />
                        </a>
                      ) : null,
                    )}
                    {ph.length > 4 && (
                      <span className="self-center text-xs text-muted-foreground">
                        +{ph.length - 4}
                      </span>
                    )}
                  </div>
                );
              })(),
              <span key="s">{statusBadge(r.status)}</span>,
              open ? (
                <div key="a" className="flex flex-wrap justify-end gap-2">
                  {r.type === "maintenance" &&
                    modules.maintenance &&
                    !r.maintenanceJobId && (
                      <form action={convertRequestToJobAction}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <Button type="submit" variant="outline" size="xs">
                          Create job
                        </Button>
                      </form>
                    )}
                  <form action={setRequestStatusAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="status" value="done" />
                    <Button type="submit" variant="outline" size="xs">
                      Mark done
                    </Button>
                  </form>
                  <form action={setRequestStatusAction}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="status" value="declined" />
                    <ConfirmSubmitButton
                      variant="outline"
                      size="xs"
                      confirmMessage={`Decline this ${r.type.replace(/_/g, " ")} request from ${r.tenant.firstName} ${r.tenant.lastName}? They'll see the status change in the portal.`}
                    >
                      Decline
                    </ConfirmSubmitButton>
                  </form>
                </div>
              ) : (
                <span key="a" className="text-xs text-muted-foreground">
                  {r.maintenanceJobId ? (
                    <Link
                      href={`/maintenance/${r.maintenanceJobId}`}
                      className="hover:underline"
                    >
                      Job created →
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
              ),
            ],
          };
        })}
      />
    </div>
  );
}
