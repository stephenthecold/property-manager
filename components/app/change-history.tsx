import Link from "next/link";
import { prisma } from "@/lib/db";
import { getDisplayRole } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { hasCapability } from "@/lib/auth/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Per-record audit trail: the latest changes touching the given entities,
 * rendered on detail pages so "who did this" is visible in place. Self-gating —
 * renders nothing unless the viewer has audit.view (same capability as the
 * global /audit page, grantable per role at Settings → Permissions).
 */
export async function ChangeHistory({
  refs,
  take = 10,
}: {
  refs: { entityType: string; entityId: string }[];
  take?: number;
}) {
  if (refs.length === 0) return null;
  const { actingRole } = await getDisplayRole();
  const { rolePermissions } = await getAppSettings();
  if (!hasCapability(actingRole, "audit.view", rolePermissions)) return null;

  // Group ids per entity type so a tenant page with many payments stays one
  // query with a few IN lists instead of hundreds of OR branches.
  const byType = new Map<string, string[]>();
  for (const r of refs) {
    const ids = byType.get(r.entityType) ?? [];
    ids.push(r.entityId);
    byType.set(r.entityType, ids);
  }
  const rows = await prisma.auditLog.findMany({
    where: {
      OR: [...byType.entries()].map(([entityType, ids]) => ({
        entityType,
        entityId: { in: ids },
      })),
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  if (rows.length === 0) return null;

  return (
    <Card className="print-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Change history</CardTitle>
        <Link
          href={
            refs.length === 1
              ? `/audit?entityType=${encodeURIComponent(refs[0].entityType)}&entityId=${encodeURIComponent(refs[0].entityId)}`
              : "/audit"
          }
          className="text-sm text-muted-foreground hover:underline"
        >
          Full audit log
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {rows.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="tabular-nums text-xs text-muted-foreground">
                {e.createdAt.toISOString().slice(0, 16).replace("T", " ")}
              </span>
              <span className="font-mono text-xs">{e.action}</span>
              <span className="text-muted-foreground">
                {e.actorEmail ?? e.actorType}
              </span>
              {e.viaBreakGlass && (
                <Badge
                  variant="outline"
                  className="border-red-200 bg-red-100 font-medium text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300"
                >
                  break-glass
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
