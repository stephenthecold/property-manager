import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/session";
import type { Prisma } from "@/lib/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

const PAGE_SIZE = 50;

function truncate(value: string, max = 12): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Read-only viewer, but the audit trail itself is sensitive: admins/owners only.
  await requireRole("admin");

  const sp = await searchParams;
  const first = (key: string): string => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  };

  const filters = {
    action: first("action"),
    entityType: first("entityType"),
    entityId: first("entityId"),
    actorEmail: first("actorEmail"),
    from: first("from"),
    to: first("to"),
  };
  const pageRaw = Number.parseInt(first("page"), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  const where: Prisma.AuditLogWhereInput = {};
  if (filters.action) {
    where.action = { contains: filters.action, mode: "insensitive" };
  }
  if (filters.entityType) {
    where.entityType = { contains: filters.entityType, mode: "insensitive" };
  }
  if (filters.entityId) {
    where.entityId = { contains: filters.entityId, mode: "insensitive" };
  }
  if (filters.actorEmail) {
    where.actorEmail = { contains: filters.actorEmail, mode: "insensitive" };
  }
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (filters.from) {
    const d = new Date(`${filters.from}T00:00:00`);
    if (!Number.isNaN(d.getTime())) createdAt.gte = d;
  }
  if (filters.to) {
    // Inclusive "to": end of that day.
    const d = new Date(`${filters.to}T23:59:59.999`);
    if (!Number.isNaN(d.getTime())) createdAt.lte = d;
  }
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  // Fetch one extra row to know whether a next page exists.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: PAGE_SIZE + 1,
    skip: (page - 1) * PAGE_SIZE,
  });
  const hasNext = rows.length > PAGE_SIZE;
  const entries = rows.slice(0, PAGE_SIZE);

  const pageHref = (p: number): string => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    if (p > 1) qs.set("page", String(p));
    const s = qs.toString();
    return s ? `/audit?${s}` : "/audit";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only record of every mutation. Newest first.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <form method="GET" action="/audit" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="action">Action contains</Label>
                <Input
                  id="action"
                  name="action"
                  defaultValue={filters.action}
                  placeholder="payment.posted"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entityType">Entity type</Label>
                <Input
                  id="entityType"
                  name="entityType"
                  defaultValue={filters.entityType}
                  placeholder="Payment"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="entityId">Entity id</Label>
                <Input id="entityId" name="entityId" defaultValue={filters.entityId} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="actorEmail">Actor email contains</Label>
                <Input
                  id="actorEmail"
                  name="actorEmail"
                  defaultValue={filters.actorEmail}
                  placeholder="admin@"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="from">From</Label>
                <Input id="from" name="from" type="date" defaultValue={filters.from} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="to">To</Label>
                <Input id="to" name="to" type="date" defaultValue={filters.to} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm">
                Apply filters
              </Button>
              <Button variant="outline" size="sm" render={<Link href="/audit" />}>
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {entries.length} {entries.length === 1 ? "entry" : "entries"} on this page
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Entity</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.id}>
              <TableCell className="tabular-nums">
                {e.createdAt.toISOString().slice(0, 19).replace("T", " ")}
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-2">
                  {e.actorEmail ?? e.actorType}
                  {e.viaBreakGlass && (
                    <Badge
                      variant="outline"
                      className="border-red-200 bg-red-100 font-medium text-red-800"
                    >
                      break-glass
                    </Badge>
                  )}
                </span>
              </TableCell>
              <TableCell className="font-mono text-xs">{e.action}</TableCell>
              <TableCell className="font-mono text-xs">
                {e.entityType ?? "—"}
                {e.entityId ? ` · ${truncate(e.entityId)}` : ""}
              </TableCell>
              <TableCell>
                {e.before != null || e.after != null ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">view</summary>
                    <pre className="mt-1 max-w-md overflow-auto rounded bg-muted/30 p-2">
                      {JSON.stringify({ before: e.before, after: e.after }, null, 2)}
                    </pre>
                  </details>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
          {entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                No audit entries yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Page {page}</p>
        <div className="flex gap-2">
          {page > 1 ? (
            <Button variant="outline" size="sm" render={<Link href={pageHref(page - 1)} />}>
              Previous
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          )}
          {hasNext ? (
            <Button variant="outline" size="sm" render={<Link href={pageHref(page + 1)} />}>
              Next
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
