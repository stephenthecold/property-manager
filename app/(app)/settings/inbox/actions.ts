"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { getAppSettings, saveInboxSettings } from "@/lib/services/app-settings";
import { requestInboxPollNow } from "@/lib/services/inbox-poll-signal";
import { isInboxOauthProvider } from "@/lib/providers/inbound-email/oauth-connect";
import {
  disconnectInboxOauth,
  saveInboxOauthClientConfig,
} from "@/lib/services/inbox-oauth";

export interface InboxSettingsState {
  ok?: boolean;
  error?: string;
  message?: string;
}

const str = (fd: FormData, key: string): string | null =>
  String(fd.get(key) ?? "").trim() || null;

export async function saveInboxAction(
  _prev: InboxSettingsState,
  fd: FormData,
): Promise<InboxSettingsState> {
  await requireCapability("messaging.settings");

  const providerRaw = String(fd.get("inboxProvider") ?? "");
  const inboxProvider =
    providerRaw === "stub" || providerRaw === "imap" ? providerRaw : null;

  const host = str(fd, "inboxImapHost");
  const user = str(fd, "inboxImapUser");
  const portRaw = str(fd, "inboxImapPort");
  const authMethodRaw = str(fd, "inboxAuthMethod");
  const authMethod =
    authMethodRaw === "oauth2" ? ("oauth2" as const) : ("password" as const);
  const tokenUrl = str(fd, "inboxOauthTokenUrl");
  const clientId = str(fd, "inboxOauthClientId");
  const scope = str(fd, "inboxOauthScope");

  // Blank secret = keep what's stored (mirrors the email/SMS semantics).
  const password = String(fd.get("inboxPassword") ?? "");
  const clientSecret = String(fd.get("inboxOauthClientSecret") ?? "");
  const refreshToken = String(fd.get("inboxOauthRefreshToken") ?? "");

  let port: number | null = null;
  if (portRaw) {
    const n = Number(portRaw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) {
      return { error: "IMAP port must be a number between 1 and 65535." };
    }
    port = n;
  }
  if (tokenUrl && !/^https:\/\//.test(tokenUrl)) {
    return { error: "The OAuth2 token URL must be an https:// URL." };
  }

  if (inboxProvider === "imap") {
    if (!host || !user) {
      return { error: "IMAP requires a host and a mailbox username." };
    }
    const settings = await getAppSettings();
    if (authMethod === "password" && !password && !settings.inboxHasPassword) {
      return { error: "IMAP password auth requires a password." };
    }
    if (authMethod === "oauth2") {
      if (!clientId) return { error: "OAuth2 requires a client ID." };
      if (!tokenUrl) return { error: "OAuth2 requires a token URL." };
      if (!clientSecret && !settings.inboxHasOauthClientSecret) {
        return { error: "OAuth2 requires a client secret." };
      }
      // No refresh token => client-credentials (app-only) grant, which is the
      // recommended O365 service path; so a refresh token is NOT required here.
    }
  }

  await saveInboxSettings(
    {
      inboxEnabled: fd.get("inboxEnabled") === "on",
      inboxProvider,
      inboxImapHost: host,
      inboxImapPort: port,
      inboxImapSecure: fd.get("inboxImapSecure") === "on",
      inboxImapUser: user,
      inboxFolder: str(fd, "inboxFolder"),
      inboxAuthMethod: inboxProvider === "imap" ? authMethod : null,
      inboxOauthClientId: clientId,
      inboxOauthTokenUrl: tokenUrl,
      inboxOauthScope: scope,
      inboxPassword: password === "" ? undefined : password,
      inboxOauthClientSecret: clientSecret === "" ? undefined : clientSecret,
      inboxOauthRefreshToken: refreshToken === "" ? undefined : refreshToken,
    },
    await auditActor(),
  );

  revalidatePath("/settings/inbox");
  revalidatePath("/inbox");
  return { ok: true, message: "Email inbox settings saved." };
}

/** Save the Microsoft/Google client app config used by the Connect redirect. */
export async function saveInboxOauthClientAction(
  _prev: InboxSettingsState,
  fd: FormData,
): Promise<InboxSettingsState> {
  await requireCapability("messaging.settings");

  const providerRaw = String(fd.get("oauthProvider") ?? "");
  if (!isInboxOauthProvider(providerRaw)) {
    return { error: "Choose Microsoft 365 or Google." };
  }
  const clientId = str(fd, "oauthClientId");
  if (!clientId) return { error: "Client ID is required." };

  const clientSecretRaw = String(fd.get("oauthClientSecret") ?? "");
  const settings = await getAppSettings();
  // A blank secret only keeps the stored one when it belongs to THIS provider —
  // otherwise we'd silently reuse the other provider's secret (→ invalid_client).
  const canKeepStored =
    settings.inboxOauthProvider === providerRaw && settings.inboxHasOauthClientSecret;
  if (!clientSecretRaw && !canKeepStored) {
    return { error: "Client secret is required." };
  }

  await saveInboxOauthClientConfig(
    {
      provider: providerRaw,
      tenant: str(fd, "oauthTenant"),
      clientId,
      clientSecret: clientSecretRaw === "" ? undefined : clientSecretRaw,
    },
    await auditActor(),
  );
  revalidatePath("/settings/inbox");
  return { ok: true, message: "Connection settings saved — now click Connect." };
}

/**
 * Ask the worker to poll the inbox immediately (Settings → "Poll now"), instead
 * of waiting for the 5-minute tick. Just emits a NOTIFY; the worker does the
 * actual poll, so this never imports the IMAP client.
 */
export async function requestInboxPollAction(): Promise<InboxSettingsState> {
  await requireCapability("messaging.settings");
  await requestInboxPollNow();
  return {
    ok: true,
    message: "Poll requested — the worker is checking the mailbox now.",
  };
}

/** Disconnect a connected mailbox (clears the refresh token, stops polling). */
export async function disconnectInboxAction(): Promise<void> {
  await requireCapability("messaging.settings");
  await disconnectInboxOauth(await auditActor());
  revalidatePath("/settings/inbox");
  revalidatePath("/inbox");
}
