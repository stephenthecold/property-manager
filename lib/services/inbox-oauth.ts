import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import {
  constantTimeEqual,
  decryptSecret,
  encryptSecret,
} from "@/lib/auth/crypto";
import { writeAudit, type AuditContext } from "@/lib/audit/audit";
import {
  INBOX_OAUTH_CLIENT_SECRET_AAD,
  INBOX_OAUTH_REFRESH_TOKEN_AAD,
  invalidateAppSettingsCache,
} from "@/lib/services/app-settings";
import {
  buildAuthorizeUrl,
  buildCodeExchangeBody,
  decodeIdTokenEmail,
  generatePkce,
  generateState,
  OAUTH_PROVIDERS,
  type InboxOauthProvider,
} from "@/lib/providers/inbound-email/oauth-connect";

/**
 * Interactive OAuth "Connect" flow for the inbound mailbox (Microsoft 365 /
 * Google). The admin clicks Connect → IdP login/consent → callback captures a
 * refresh token here, which the worker poll then uses. This module is framework-
 * agnostic (no next/headers, no imapflow) so it's safe in both routes and the
 * worker. CSRF is covered by an encrypted, short-lived state cookie + PKCE.
 */

export const INBOX_OAUTH_STATE_COOKIE = "inbox_oauth_state";
export const INBOX_OAUTH_COOKIE_PATH = "/api/inbox/oauth";
const STATE_AAD = "inbox:oauth:state";
const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  provider: InboxOauthProvider;
  state: string;
  verifier: string;
  exp: number;
}

/** Encrypt the CSRF state + PKCE verifier into an opaque cookie value. */
function packState(p: StatePayload): string {
  const enc = encryptSecret(JSON.stringify(p), STATE_AAD);
  return Buffer.from(JSON.stringify(enc), "utf8").toString("base64url");
}

function unpackState(cookie: string | undefined | null): StatePayload | null {
  if (!cookie) return null;
  try {
    const enc = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
    const p = JSON.parse(decryptSecret(enc, STATE_AAD)) as StatePayload;
    if (
      !p ||
      (p.provider !== "microsoft" && p.provider !== "google") ||
      typeof p.state !== "string" ||
      typeof p.verifier !== "string" ||
      typeof p.exp !== "number"
    ) {
      return null;
    }
    if (Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

/** The exact redirect URI the operator must register with the IdP. */
export function inboxOauthRedirectUri(provider: InboxOauthProvider): string {
  const base = getEnv().APP_URL.replace(/\/$/, "");
  return `${base}/api/inbox/oauth/${provider}/callback`;
}

/**
 * Persist the IdP client config (client id/secret, MS tenant) and derive the
 * token URL / scope / IMAP host from the provider — so the worker can poll once
 * a refresh token is captured. Does NOT enable polling or store a token yet.
 */
export async function saveInboxOauthClientConfig(
  input: {
    provider: InboxOauthProvider;
    tenant: string | null;
    clientId: string;
    /** undefined = keep stored; "" clears; a string replaces. */
    clientSecret?: string;
  },
  actor: AuditContext,
): Promise<void> {
  const ep = OAUTH_PROVIDERS[input.provider];
  const tenant =
    input.provider === "microsoft" ? input.tenant?.trim() || "common" : null;
  const secretFields =
    input.clientSecret === undefined
      ? {}
      : input.clientSecret === ""
        ? {
            inboxOauthClientSecretCiphertext: null,
            inboxOauthClientSecretNonce: null,
            inboxOauthClientSecretTag: null,
          }
        : (() => {
            const e = encryptSecret(input.clientSecret, INBOX_OAUTH_CLIENT_SECRET_AAD);
            return {
              inboxOauthClientSecretCiphertext: e.ciphertext,
              inboxOauthClientSecretNonce: e.nonce,
              inboxOauthClientSecretTag: e.tag,
            };
          })();
  const data = {
    inboxProvider: ep.providerKind,
    inboxAuthMethod: "oauth2",
    inboxOauthProvider: input.provider,
    inboxOauthTenant: tenant,
    inboxOauthClientId: input.clientId,
    inboxOauthTokenUrl: ep.tokenUrl(tenant),
    inboxOauthScope: ep.runtimeScope,
    inboxImapHost: ep.imapHost,
    inboxImapPort: 993,
    inboxImapSecure: true,
    ...secretFields,
    updatedBy: actor.actorId ?? null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.appSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", ...data },
      update: data,
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.inbox.oauth_config",
      entityType: "AppSettings",
      entityId: "singleton",
      after: {
        provider: input.provider,
        tenant,
        clientIdSet: !!input.clientId,
        clientSecretChanged: input.clientSecret !== undefined,
      },
    });
  });
  invalidateAppSettingsCache();
}

/**
 * Build the IdP authorize URL + the state cookie value for a Connect click.
 * Throws (operator-actionable) when the client config hasn't been saved yet.
 */
export async function beginInboxOauth(
  provider: InboxOauthProvider,
): Promise<{ redirectUrl: string; cookie: string }> {
  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  const clientId = row?.inboxOauthClientId;
  if (!clientId || !row?.inboxOauthClientSecretCiphertext) {
    throw new Error(
      "Save the client ID and secret first, then click Connect.",
    );
  }
  const tenant = row.inboxOauthTenant ?? null;
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  const redirectUrl = buildAuthorizeUrl({
    provider,
    tenant,
    clientId,
    redirectUri: inboxOauthRedirectUri(provider),
    scope: OAUTH_PROVIDERS[provider].defaultScope,
    state,
    codeChallenge: challenge,
  });
  const cookie = packState({
    provider,
    state,
    verifier,
    exp: Date.now() + STATE_TTL_MS,
  });
  return { redirectUrl, cookie };
}

/**
 * Finish the redirect: verify state (CSRF) + PKCE, exchange the code for tokens,
 * and store the refresh token + connected mailbox. All failures are returned as
 * operator-actionable messages (surfaced as a banner), never thrown to a 500.
 */
export async function completeInboxOauth(input: {
  provider: InboxOauthProvider;
  code: string;
  state: string;
  cookieValue: string | undefined | null;
  actor: AuditContext;
}): Promise<{ ok: true; mailbox: string } | { ok: false; error: string }> {
  const payload = unpackState(input.cookieValue);
  if (!payload) {
    return { ok: false, error: "Connect session expired — start again." };
  }
  if (payload.provider !== input.provider) {
    return { ok: false, error: "Provider mismatch — start again." };
  }
  if (!constantTimeEqual(payload.state, input.state)) {
    return { ok: false, error: "State verification failed — start again." };
  }

  const row = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (
    !row?.inboxOauthClientId ||
    !row.inboxOauthClientSecretCiphertext ||
    !row.inboxOauthClientSecretNonce ||
    !row.inboxOauthClientSecretTag
  ) {
    return { ok: false, error: "Client settings are missing — save them first." };
  }
  const clientSecret = decryptSecret(
    {
      ciphertext: row.inboxOauthClientSecretCiphertext,
      nonce: row.inboxOauthClientSecretNonce,
      tag: row.inboxOauthClientSecretTag,
    },
    INBOX_OAUTH_CLIENT_SECRET_AAD,
  );
  const tenant = row.inboxOauthTenant ?? null;
  const ep = OAUTH_PROVIDERS[input.provider];
  const tokenUrl = ep.tokenUrl(tenant);

  let json: { access_token?: string; refresh_token?: string; id_token?: string };
  try {
    const res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: buildCodeExchangeBody({
        clientId: row.inboxOauthClientId,
        clientSecret,
        code: input.code,
        redirectUri: inboxOauthRedirectUri(input.provider),
        codeVerifier: payload.verifier,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Token exchange failed (${res.status}): ${detail.slice(0, 150)}`,
      };
    }
    json = (await res.json()) as typeof json;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Token exchange failed.",
    };
  }

  if (!json.refresh_token) {
    return {
      ok: false,
      error:
        "No refresh token returned. Re-run Connect and grant offline access (Google: remove the app's access first, then retry).",
    };
  }
  const mailbox = decodeIdTokenEmail(json.id_token) ?? row.inboxImapUser ?? "";
  if (!mailbox) {
    // Without the mailbox address the worker can't log in (resolveInboxProvider
    // needs a user), so don't report a misleading "connected" with a dead poll.
    return {
      ok: false,
      error:
        "Connected, but the sign-in didn't return a mailbox address. Ensure the app requests the openid + email scope, then reconnect.",
    };
  }
  const enc = encryptSecret(json.refresh_token, INBOX_OAUTH_REFRESH_TOKEN_AAD);

  await prisma.$transaction(async (tx) => {
    await tx.appSettings.update({
      where: { id: "singleton" },
      data: {
        inboxEnabled: true,
        inboxProvider: ep.providerKind,
        inboxAuthMethod: "oauth2",
        inboxOauthProvider: input.provider,
        inboxImapHost: ep.imapHost,
        inboxImapPort: 993,
        inboxImapSecure: true,
        inboxImapUser: mailbox,
        inboxOauthTokenUrl: tokenUrl,
        inboxOauthScope: ep.runtimeScope,
        inboxOauthRefreshTokenCiphertext: enc.ciphertext,
        inboxOauthRefreshTokenNonce: enc.nonce,
        inboxOauthRefreshTokenTag: enc.tag,
        updatedBy: input.actor.actorId ?? null,
      },
    });
    await writeAudit(tx, {
      ...input.actor,
      action: "settings.inbox.connected",
      entityType: "AppSettings",
      entityId: "singleton",
      after: { provider: input.provider, mailbox: mailbox || null },
    });
  });
  invalidateAppSettingsCache();
  return { ok: true, mailbox: mailbox || "(unknown mailbox)" };
}

/** Persist a ROTATED refresh token (no audit — routine token refresh). */
export async function persistRotatedInboxRefreshToken(token: string): Promise<void> {
  const enc = encryptSecret(token, INBOX_OAUTH_REFRESH_TOKEN_AAD);
  await prisma.appSettings.update({
    where: { id: "singleton" },
    data: {
      inboxOauthRefreshTokenCiphertext: enc.ciphertext,
      inboxOauthRefreshTokenNonce: enc.nonce,
      inboxOauthRefreshTokenTag: enc.tag,
    },
  });
  invalidateAppSettingsCache();
}

/** Disconnect: clear the refresh token + stop polling, keep client settings. */
export async function disconnectInboxOauth(actor: AuditContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.appSettings.update({
      where: { id: "singleton" },
      data: {
        inboxEnabled: false,
        inboxOauthRefreshTokenCiphertext: null,
        inboxOauthRefreshTokenNonce: null,
        inboxOauthRefreshTokenTag: null,
        updatedBy: actor.actorId ?? null,
      },
    });
    await writeAudit(tx, {
      ...actor,
      action: "settings.inbox.disconnected",
      entityType: "AppSettings",
      entityId: "singleton",
      after: { disconnected: true },
    });
  });
  invalidateAppSettingsCache();
}
