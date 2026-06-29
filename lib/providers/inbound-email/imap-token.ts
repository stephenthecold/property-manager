/**
 * OAuth2 (XOAUTH2) access tokens for IMAP. Microsoft 365 disables IMAP Basic
 * Auth, so an O365 mailbox authenticates with a short-lived access token minted
 * here from the configured client. Two grants, chosen by what is configured:
 *   - a refresh token  -> refresh_token grant (delegated, IMAP.AccessAsUser.All)
 *   - no refresh token -> client_credentials grant (app-only, IMAP.AccessAsApp)
 * The default scope targets Outlook IMAP; other IdPs can override it.
 */

import { unsafeOutboundUrlReason } from "@/lib/http/safe-url";

export const DEFAULT_IMAP_OAUTH_SCOPE = "https://outlook.office365.com/.default";

export interface ImapOauthConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  scope: string;
  /** When present, a delegated refresh-token grant is used instead of app-only. */
  refreshToken?: string | null;
  /** Called with a ROTATED refresh token (Microsoft rotates on each grant) so a
   *  delegated connection can persist it and keep working. */
  onRefreshToken?: (token: string) => Promise<void>;
}

export interface ImapTokenResult {
  accessToken: string;
  /** Present when the IdP rotated/returned a (new) refresh token. */
  refreshToken?: string;
}

/** Build the token-endpoint POST body. PURE — unit-tested without a network. */
export function buildImapTokenRequestBody(cfg: ImapOauthConfig): URLSearchParams {
  const body = new URLSearchParams();
  body.set("client_id", cfg.clientId);
  body.set("client_secret", cfg.clientSecret);
  body.set("scope", cfg.scope || DEFAULT_IMAP_OAUTH_SCOPE);
  if (cfg.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", cfg.refreshToken);
  } else {
    body.set("grant_type", "client_credentials");
  }
  return body;
}

/** Fetch an access token from the OAuth2 token endpoint. Throws on failure. */
export async function fetchImapAccessToken(
  cfg: ImapOauthConfig,
): Promise<ImapTokenResult> {
  if (!cfg.tokenUrl) {
    throw new Error("OAuth2 token URL is not set.");
  }
  // Defense-in-depth SSRF/exfil guard at the sink: never POST the client secret
  // to a non-public host, even if a bad value was stored by some other path.
  const unsafe = unsafeOutboundUrlReason(cfg.tokenUrl);
  if (unsafe) {
    throw new Error(`OAuth2 token URL ${unsafe}`);
  }
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: buildImapTokenRequestBody(cfg),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OAuth2 token request failed (${res.status}): ${detail.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!json.access_token) {
    throw new Error("OAuth2 token response had no access_token.");
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token };
}
