import Link from "next/link";
import { requireCapability } from "@/lib/auth/session";
import { getAppSettings } from "@/lib/services/app-settings";
import { inboxOauthRedirectUri } from "@/lib/services/inbox-oauth";
import { inboxHealth } from "@/lib/services/inbox-health";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InboxForm, type InboxInitial } from "./inbox-form";
import { InboxConnect, type InboxConnectInitial } from "./inbox-connect";
import { InboxHealthPanel } from "./health-panel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDER_LABEL: Record<string, string> = {
  microsoft: "Microsoft 365",
  google: "Google / Gmail",
};

export default async function InboxSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireCapability("messaging.settings");
  const s = await getAppSettings();
  const sp = await searchParams;
  const connected = Array.isArray(sp.connected) ? sp.connected[0] : sp.connected;
  const error = Array.isArray(sp.error) ? sp.error[0] : sp.error;

  const now = new Date();
  const health = inboxHealth({
    moduleEnabled: s.modules.mailbox,
    inboxEnabled: s.inboxEnabled,
    lastPolledAt: s.inboxLastPolledAt,
    lastError: s.inboxLastError,
    now,
  });

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

  const connectInitial: InboxConnectInitial = {
    provider: s.inboxOauthProvider ?? "",
    tenant: s.inboxOauthTenant ?? "",
    clientId: s.inboxOauthClientId ?? "",
    hasClientSecret: s.inboxHasOauthClientSecret,
    connected: !!s.inboxOauthProvider && s.inboxHasOauthRefreshToken,
    connectedProvider: s.inboxOauthProvider,
    connectedMailbox: s.inboxImapUser ?? "",
    redirectUri: {
      microsoft: inboxOauthRedirectUri("microsoft"),
      google: inboxOauthRedirectUri("google"),
    },
  };

  return (
    <div className="space-y-4">
      {connected && (
        <Alert>
          <AlertDescription>
            Connected to {PROVIDER_LABEL[connected] ?? connected}
            {connectInitial.connectedMailbox
              ? ` as ${connectInitial.connectedMailbox}`
              : ""}
            . Mail polling is on.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <InboxHealthPanel
        report={health}
        lastPolledAt={s.inboxLastPolledAt}
        fetched={s.inboxLastFetched}
        processed={s.inboxLastProcessed}
        failed={s.inboxLastFailed}
        now={now}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect a mailbox (recommended)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            One-click sign-in for Microsoft 365 or Google — the secure way (no
            pasted tokens). Captures mail into the staff{" "}
            <Link href="/inbox" className="underline">
              Email inbox
            </Link>{" "}
            so emailed invoices/receipts can be reviewed and posted to Financials.
            Turn the module on under{" "}
            <Link href="/settings/modules" className="underline">
              Settings → Modules → Email inbox
            </Link>
            .
          </p>
          <InboxConnect initial={connectInitial} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Advanced (manual IMAP)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Manual setup for self-hosted IMAP, a Gmail app password, the stub
            demo provider, or app-only OAuth2. The Connect buttons above manage
            the OAuth credentials for you; you don&apos;t need this section if you
            connected above.
          </p>
          <InboxForm initial={initial} />
        </CardContent>
      </Card>
    </div>
  );
}
