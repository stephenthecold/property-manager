import Link from "next/link";
import { MessageSquareIcon } from "lucide-react";
import { requireCapability } from "@/lib/auth/session";
import {
  listInboundMessages,
  type InboundMessageRow,
} from "@/lib/services/inbound-messages";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markInboundReadAction } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function tenantLabel(m: InboundMessageRow): string {
  return m.tenant
    ? `${m.tenant.firstName} ${m.tenant.lastName}`
    : "Unknown sender";
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("tenants.manage");
  const sp = await searchParams;
  const rawFilter = Array.isArray(sp.filter) ? sp.filter[0] : sp.filter;
  const unreadOnly = rawFilter === "unread";

  const messages = await listInboundMessages({ unreadOnly });
  const unreadCount = unreadOnly
    ? messages.length
    : messages.filter((m) => !m.readAt).length;

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Messages"
        description="Inbound SMS replies from tenants, newest first. STOP/START/HELP keywords are handled automatically and never appear here. Replies are read-only — send outbound messages from Reminders."
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            Inbox{" "}
            {unreadCount > 0 && (
              <Badge
                variant="outline"
                className="ml-1 border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
              >
                {unreadCount} unread
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant={unreadOnly ? "ghost" : "secondary"}
              size="xs"
              render={<Link href="/messages" />}
            >
              All
            </Button>
            <Button
              variant={unreadOnly ? "secondary" : "ghost"}
              size="xs"
              render={<Link href="/messages?filter=unread" />}
            >
              Unread
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            emptyState={
              <EmptyState
                icon={<MessageSquareIcon />}
                title={unreadOnly ? "No unread messages" : "No messages yet"}
                description={
                  unreadOnly
                    ? "Every reply has been read. Switch to All to see the full thread history."
                    : "Inbound SMS replies from tenants will show up here."
                }
                action={
                  unreadOnly ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href="/messages" />}
                    >
                      View all
                    </Button>
                  ) : undefined
                }
              />
            }
            columns={[
              { key: "received", label: "Received" },
              { key: "from", label: "From" },
              { key: "tenant", label: "Tenant" },
              { key: "body", label: "Message", sortable: false },
              { key: "actions", label: "", align: "right", sortable: false },
            ]}
            rows={messages.map((m) => ({
              key: m.id,
              sortValues: [
                String(m.receivedAt.getTime()),
                m.fromPhone,
                tenantLabel(m),
                null,
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
                <span key="f" className="font-mono text-sm">
                  {m.fromPhone}
                </span>,
                m.tenant ? (
                  <Link
                    key="t"
                    href={`/tenants/${m.tenant.id}`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {tenantLabel(m)}
                  </Link>
                ) : (
                  <span key="t" className="text-muted-foreground">
                    Unknown sender
                  </span>
                ),
                <span key="b" className="whitespace-pre-wrap break-words">
                  {m.body || <span className="text-muted-foreground">(empty)</span>}
                </span>,
                <span key="a" className="inline-flex justify-end">
                  {!m.readAt && (
                    <form action={markInboundReadAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <Button type="submit" variant="outline" size="xs">
                        Mark read
                      </Button>
                    </form>
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
