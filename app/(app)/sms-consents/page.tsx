import Link from "next/link";
import { requireCapability } from "@/lib/auth/session";
import { publicBaseUrl } from "@/lib/http/base-url";
import { listTenantConsentStatuses } from "@/lib/services/sms-consent";
import {
  SMS_CONSENT_STATUS_LABEL,
  type SmsConsentStatus,
} from "@/lib/sms/consent-status";
import { DataTable } from "@/components/app/data-table";
import { FormDialog } from "@/components/app/form-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { sendOptInInviteEmailAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<SmsConsentStatus, string> = {
  opted_in:
    "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  opted_out:
    "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  not_opted_in:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  missing_mobile: "border-muted bg-muted text-muted-foreground",
};

const STATUSES: SmsConsentStatus[] = [
  "opted_in",
  "not_opted_in",
  "opted_out",
  "missing_mobile",
];

export default async function SmsConsentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("tenants.manage");
  const sp = await searchParams;
  const raw = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const filter = (STATUSES as string[]).includes(raw ?? "")
    ? (raw as SmsConsentStatus)
    : undefined;

  const all = await listTenantConsentStatuses();
  const rows = filter ? all.filter((t) => t.status === filter) : all;
  const optInUrl = `${(await publicBaseUrl()).replace(/\/+$/, "")}/sms-opt-in`;

  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, all.filter((t) => t.status === s).length]),
  ) as Record<SmsConsentStatus, number>;

  return (
    <div className="w-full space-y-4">
      <div>
        <h2 className="text-lg font-semibold">SMS consent</h2>
        <p className="text-sm text-muted-foreground">
          SMS opt-in status for every active tenant. Invite tenants to opt in by
          email or a printable letter — never by SMS.
        </p>
        <p className="mt-1 text-sm">
          Public opt-in page:{" "}
          <a
            href={optInUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-primary underline underline-offset-2"
          >
            {optInUrl}
          </a>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tenants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form method="GET" className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="status">Filter by status</Label>
              <select
                id="status"
                name="status"
                defaultValue={filter ?? ""}
                className="h-9 w-56 rounded-md border px-3 text-sm"
              >
                <option value="">All ({all.length})</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {SMS_CONSENT_STATUS_LABEL[s]} ({counts[s]})
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {filter && (
              <Button variant="ghost" size="sm" render={<Link href="/sms-consents" />}>
                Clear
              </Button>
            )}
          </form>

          <DataTable
            emptyMessage="No tenants match this filter."
            columns={[
              { key: "name", label: "Tenant" },
              { key: "phone", label: "Mobile" },
              { key: "email", label: "Email", className: "hidden md:table-cell" },
              { key: "status", label: "Status" },
              { key: "actions", label: "", align: "right", sortable: false },
            ]}
            rows={rows.map((t) => ({
              key: t.id,
              sortValues: [
                `${t.lastName} ${t.firstName}`,
                t.phone ?? null,
                t.email ?? null,
                t.status,
                null,
              ],
              cells: [
                <Link
                  key="n"
                  href={`/tenants/${t.id}`}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t.firstName} {t.lastName}
                </Link>,
                t.phone ?? "—",
                t.email ?? "—",
                <Badge
                  key="s"
                  variant="outline"
                  className={`font-medium ${STATUS_BADGE[t.status]}`}
                >
                  {SMS_CONSENT_STATUS_LABEL[t.status]}
                </Badge>,
                <span key="a" className="inline-flex justify-end gap-1">
                  {t.status !== "opted_in" && t.email && (
                    <FormDialog
                      trigger="Email invite"
                      triggerVariant="outline"
                      triggerSize="xs"
                      title="Invite to opt in (email)"
                      description={`Email ${t.firstName} a link to the public opt-in page. No SMS is sent.`}
                      action={sendOptInInviteEmailAction}
                      submitLabel="Send invite"
                    >
                      <input type="hidden" name="tenantId" value={t.id} />
                      <p className="text-sm text-muted-foreground">
                        Sends to <span className="font-medium">{t.email}</span>.
                      </p>
                    </FormDialog>
                  )}
                  {t.status !== "opted_in" && (
                    <Button
                      variant="outline"
                      size="xs"
                      render={
                        <Link href={`/sms-consents/letter?tenantId=${t.id}`} target="_blank" />
                      }
                    >
                      Printable letter
                    </Button>
                  )}
                </span>,
              ],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
