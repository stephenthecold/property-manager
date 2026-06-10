import Link from "next/link";
import { getOverdue, getRentRoll } from "@/lib/services/reports";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const runtime = "nodejs";

function money(v: string) {
  return `$${v}`;
}

export default async function ReportsPage() {
  const now = new Date();
  const [rentRoll, overdue] = await Promise.all([getRentRoll(now), getOverdue(now)]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Rent roll</CardTitle>
          <Button render={<Link href="/api/reports/rent-roll" />} variant="outline" size="sm">
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Property</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Tenant</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Rent</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Past due</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rentRoll.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.property}</TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell>{r.tenant}</TableCell>
                  <TableCell className="capitalize">{r.status.replace("_", " ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.rent)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.pastDue)}</TableCell>
                </TableRow>
              ))}
              {rentRoll.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No active leases.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Overdue tenants</CardTitle>
          <Button render={<Link href="/api/reports/overdue" />} variant="outline" size="sm">
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tenant</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Past due</TableHead>
                <TableHead className="text-right">Days since paid</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overdue.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.tenant}</TableCell>
                  <TableCell>
                    {r.property} · {r.unit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.balance)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.pastDue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.lastPaidDays || "—"}</TableCell>
                </TableRow>
              ))}
              {overdue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No overdue tenants.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
