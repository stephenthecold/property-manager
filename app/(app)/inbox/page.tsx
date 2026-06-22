import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  listInboundEmails,
  type InboundEmailRow,
  type InboxStatus,
} from "@/lib/services/inbound-email";
import { DataTable } from "@/components/app/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIEWS: { key: InboxStatus | "all"; label: string; href: string }[] = [
  { key: "new", label: "Inbox", href: "/inbox" },
  { key: "archived", label: "Archived", href: "/inbox?view=archived" },
  { key: "posted", label: "Posted", href: "/inbox?view=posted" },
  { key: "all", label: "All", href: "/inbox?view=all" },
];

function senderLabel(m: InboundEmailRow): string {
  return m.fromName ? `${m.fromName}` : m.fromEmail;
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    new: "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
    posted:
      "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
    archived:
      "border-muted-foreground/30 bg-muted text-muted-foreground",
  };
  return (
    <Badge variant="outline" className={map[status] ?? map.archived}>
      {status}
    </Badge>
  );
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("mailbox.manage");
  const app = await getAppSettings();
  if (!app.modules.mailbox) redirect("/dashboard");

  const sp = await searchParams;
  const raw = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: InboxStatus | "all" =
    raw === "archived" || raw === "posted" || raw === "all" ? raw : "new";

  const messages = await listInboundEmails({ status: view });
  const unreadCount = messages.filter((m) => !m.readAt).length;

  return (
    <div className="w-full space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Email inbox</h2>
        <p className="text-sm text-muted-foreground">
          Mail captured from your configured mailbox, newest first. Open a message
          to review attachments and post an invoice/receipt as an expense.
          Configure the mailbox under{" "}
          <Link href="/settings/inbox" className="underline">
            Settings → Email inbox
          </Link>
          .
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            {VIEWS.find((v) => v.key === view)?.label ?? "Inbox"}{" "}
            {view === "new" && unreadCount > 0 && (
              <Badge
                variant="outline"
                className="ml-1 border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
              >
                {unreadCount} unread
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {VIEWS.map((v) => (
              <Button
                key={v.key}
                variant={v.key === view ? "secondary" : "ghost"}
                size="xs"
                render={<Link href={v.href} />}
              >
                {v.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyMessage={
              view === "new" ? "No new mail." : `No ${view} messages.`
            }
            columns={[
              { key: "received", label: "Received" },
              { key: "from", label: "From" },
              { key: "subject", label: "Subject" },
              { key: "tenant", label: "Tenant" },
              { key: "files", label: "Files", numeric: true, align: "right" },
              { key: "status", label: "Status" },
              { key: "actions", label: "", align: "right", sortable: false },
            ]}
            rows={messages.map((m) => ({
              key: m.id,
              sortValues: [
                String(m.receivedAt.getTime()),
                senderLabel(m),
                m.subject ?? "",
                m.tenant ? `${m.tenant.lastName} ${m.tenant.firstName}` : "",
                m.attachmentCount,
                m.status,
                null,
              ],
              cells: [
                <span key="r" className="whitespace-nowrap text-sm">
                  {m.receivedAt.toLocaleString()}
                  {!m.readAt && (
                    <Badge
                      variant="outline"
                      className="ml-2 border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                    >
                      New
                    </Badge>
                  )}
                </span>,
                <span key="f" className="text-sm">
                  <span className="block font-medium">{senderLabel(m)}</span>
                  {m.fromName && (
                    <span className="block font-mono text-xs text-muted-foreground">
                      {m.fromEmail}
                    </span>
                  )}
                </span>,
                <span key="s" className="break-words">
                  {m.subject || (
                    <span className="text-muted-foreground">(no subject)</span>
                  )}
                </span>,
                m.tenant ? (
                  <Link
                    key="t"
                    href={`/tenants/${m.tenant.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {m.tenant.firstName} {m.tenant.lastName}
                  </Link>
                ) : (
                  <span key="t" className="text-muted-foreground">
                    —
                  </span>
                ),
                <span key="fi" className="tabular-nums">
                  {m.attachmentCount > 0 ? m.attachmentCount : "—"}
                </span>,
                <span key="st">{statusBadge(m.status)}</span>,
                <Button
                  key="a"
                  variant="outline"
                  size="xs"
                  render={<Link href={`/inbox/${m.id}`} />}
                >
                  Open
                </Button>,
              ],
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
