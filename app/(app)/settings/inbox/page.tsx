import Link from "next/link";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InboxForm, type InboxInitial } from "./inbox-form";

export const runtime = "nodejs";

export default async function InboxSettingsPage() {
  await requireCapability("messaging.settings");
  const s = await getAppSettings();

  const initial: InboxInitial = {
    inboxEnabled: s.inboxEnabled,
    inboxProvider: s.inboxProvider ?? "",
    inboxImapHost: s.inboxImapHost ?? "",
    inboxImapPort: s.inboxImapPort != null ? String(s.inboxImapPort) : "",
    inboxImapSecure: s.inboxImapSecure,
    inboxImapUser: s.inboxImapUser ?? "",
    inboxFolder: s.inboxFolder ?? "",
    inboxAuthMethod: s.inboxAuthMethod ?? "password",
    inboxOauthClientId: s.inboxOauthClientId ?? "",
    inboxOauthTokenUrl: s.inboxOauthTokenUrl ?? "",
    inboxOauthScope: s.inboxOauthScope ?? "",
    hasPassword: s.inboxHasPassword,
    hasOauthClientSecret: s.inboxHasOauthClientSecret,
    hasOauthRefreshToken: s.inboxHasOauthRefreshToken,
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Email inbox (IMAP)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Capture a mailbox into a staff{" "}
          <Link href="/inbox" className="underline">
            Email inbox
          </Link>{" "}
          so emailed invoices/receipts can be reviewed and posted to Financials.
          The worker polls every few minutes; capture is read-only (messages are
          marked <em>seen</em>, never deleted) and de-duplicated. Turn the feature
          on under{" "}
          <Link href="/settings/modules" className="underline">
            Settings → Modules → Email inbox
          </Link>
          ; setup details (Microsoft 365 app registration, Gmail app password,
          self-hosted) are in <span className="font-mono">docs/EMAIL_INBOX.md</span>.
        </p>
        <InboxForm initial={initial} />
      </CardContent>
    </Card>
  );
}
