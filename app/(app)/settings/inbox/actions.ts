"use server";

import { revalidatePath } from "next/cache";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { getAppSettings, saveInboxSettings } from "@/lib/services/app-settings";

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
