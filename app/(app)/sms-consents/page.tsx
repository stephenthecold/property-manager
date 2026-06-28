import Link from "next/link";
import { MessageSquareIcon } from "lucide-react";
import { requireCapability } from "@/lib/auth/session";
import { publicBaseUrl } from "@/lib/http/base-url";
import { listTenantConsentStatuses } from "@/lib/services/sms-consent";
import {
  SMS_CONSENT_STATUS_LABEL,
  type SmsConsentStatus,
} from "@/lib/sms/consent-status";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { FormDialog } from "@/components/app/form-dialog";
import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/status-badge";
import type { Tone } from "@/lib/ui/status-tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { sendOptInInviteEmailAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<SmsConsentStatus, Tone> = {
  opted_in: "success",
  opted_out: "danger",
  not_opted_in: "warning",
  missing_mobile: "neutral",
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
      <PageHeader
        title="SMS consent"
        description="SMS opt-in status for every active tenant. Invite tenants to opt in by email or a printable letter — never by SMS."
      />
      <p className="text-sm">
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
            emptyState={
              <EmptyState
                icon={<MessageSquareIcon />}
                title={filter ? "No tenants match this filter" : "No tenants yet"}
                description={
                  filter
                    ? "No active tenants have this consent status — try a different filter."
                    : "Add active tenants to track their SMS opt-in status here."
                }
                action={
                  filter ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href="/sms-consents" />}
                    >
                      Clear filter
                    </Button>
                  ) : undefined
                }
              />
            }
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
                <ToneBadge key="s" tone={STATUS_TONE[t.status]}>
                  {SMS_CONSENT_STATUS_LABEL[t.status]}
                </ToneBadge>,
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
