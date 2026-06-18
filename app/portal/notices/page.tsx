import Link from "next/link";
import { requirePortalSession } from "@/lib/portal/session";
import { listServedNoticesForTenant } from "@/lib/services/notices";
import { noticeTypeLabel } from "@/lib/notices/templates";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Tenant-facing notices inbox: the formal notices SERVED to the signed-in
 * tenant, newest first. requirePortalSession() is the only gate (/portal is a
 * staff-middleware PUBLIC_PREFIX), and the query is scoped to THIS tenant's id
 * (status "served" + non-null servedAt) so drafts/void notices and other
 * tenants' notices are never reachable. Read-only — no mutations, no downloads.
 */
export default async function PortalNoticesPage() {
  const { tenant } = await requirePortalSession();
  const notices = await listServedNoticesForTenant(tenant.id);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Notices</h1>
        <Button variant="ghost" size="sm" render={<Link href="/portal" />}>
          Back to portal
        </Button>
      </div>

      {notices.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            You have no notices.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {notices.map((n) => (
            <Card key={n.id}>
              <CardHeader>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <CardTitle className="text-base">{n.subject}</CardTitle>
                  {n.servedAt && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Served {fmtDate(n.servedAt)}
                    </span>
                  )}
                </div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {noticeTypeLabel(n.type)}
                </div>
              </CardHeader>
              <CardContent>
                <div className="whitespace-pre-wrap text-sm text-foreground">{n.body}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
