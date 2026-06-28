import Link from "next/link";
import { redirect } from "next/navigation";
import { MailIcon } from "lucide-react";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import {
  listInboundEmails,
  type InboundEmailRow,
  type InboxStatus,
} from "@/lib/services/inbound-email";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ToneBadge } from "@/components/status-badge";
import type { Tone } from "@/lib/ui/status-tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { clearInboxAction } from "./actions";

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

const STATUS_TONE: Record<string, Tone> = {
  new: "info",
  posted: "success",
  archived: "neutral",
};

function statusBadge(status: string) {
  return <ToneBadge tone={STATUS_TONE[status] ?? "neutral"}>{status}</ToneBadge>;
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
  // Non-posted items in this view can be cleared (posted ones are kept).
  const deletableCount = messages.filter((m) => m.status !== "posted").length;

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Email inbox"
        description={
          <>
            Mail captured from your configured mailbox, newest first. Open a
            message to review attachments and post an invoice/receipt as an
            expense. Configure the mailbox under{" "}
            <Link href="/settings/inbox" className="underline">
              Settings → Email inbox
            </Link>
            .
          </>
        }
        actions={
          deletableCount > 0 ? (
            <form action={clearInboxAction}>
              <ConfirmSubmitButton
                size="sm"
                confirmMessage="Permanently delete ALL non-posted inbox messages and their attachments? Posted items (already saved as expenses) are kept. This can't be undone."
              >
                Clear inbox
              </ConfirmSubmitButton>
            </form>
          ) : undefined
        }
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">
            {VIEWS.find((v) => v.key === view)?.label ?? "Inbox"}{" "}
            {view === "new" && unreadCount > 0 && (
              <ToneBadge tone="info" className="ml-1">
                {unreadCount} unread
              </ToneBadge>
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
            emptyState={
              <EmptyState
                icon={<MailIcon />}
                title={view === "new" ? "No new mail" : `No ${view} messages`}
                description={
                  view === "new"
                    ? "Captured invoices and receipts from your configured mailbox will appear here."
                    : "Nothing in this view yet — try a different tab."
                }
              />
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
                    <ToneBadge tone="info" className="ml-2">
                      New
                    </ToneBadge>
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
