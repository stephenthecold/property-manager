import { createHash, randomBytes } from "node:crypto";

/**
 * Interactive OAuth "Connect" flow for the inbound mailbox — the authorization-
 * code + PKCE redirect that captures a refresh token (FreeScout's "Connect to
 * Microsoft 365" pattern), for Microsoft 365 and Google/Gmail. PURE + DB-free so
 * it's unit-tested without a network. The captured refresh token is then used by
 * the existing worker poll (refresh_token grant) to mint IMAP XOAUTH2 tokens.
 */

export type InboxOauthProvider = "microsoft" | "google";

export function isInboxOauthProvider(v: string): v is InboxOauthProvider {
  return v === "microsoft" || v === "google";
}

export interface ProviderEndpoints {
  authorizeUrl: (tenant: string | null) => string;
  tokenUrl: (tenant: string | null) => string;
  /** Scope for the AUTHORIZE request: IMAP + offline_access (refresh token) +
   *  openid/email (so the id_token carries the mailbox address). */
  defaultScope: string;
  /** Scope the WORKER replays on the refresh_token grant: the resource scope
   *  ONLY. Microsoft can reject mixing OIDC (openid/email) with a resource scope
   *  on a token request, so the runtime scope must omit them. */
  imapScope: string;
  imapHost: string;
}

const MICROSOFT_BASE = "https://login.microsoftonline.com";

export const OAUTH_PROVIDERS: Record<InboxOauthProvider, ProviderEndpoints> = {
  microsoft: {
    authorizeUrl: (tenant) =>
      `${MICROSOFT_BASE}/${encodeURIComponent(tenant || "common")}/oauth2/v2.0/authorize`,
    tokenUrl: (tenant) =>
      `${MICROSOFT_BASE}/${encodeURIComponent(tenant || "common")}/oauth2/v2.0/token`,
    defaultScope:
      "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access openid email",
    imapScope: "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access",
    imapHost: "outlook.office365.com",
  },
  google: {
    authorizeUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: () => "https://oauth2.googleapis.com/token",
    defaultScope: "https://mail.google.com/ openid email",
    imapScope: "https://mail.google.com/",
    imapHost: "imap.gmail.com",
  },
};

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** PKCE verifier + S256 challenge (RFC 7636). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Opaque, unguessable CSRF state. */
export function generateState(): string {
  return base64url(randomBytes(24));
}

export interface AuthorizeUrlInput {
  provider: InboxOauthProvider;
  tenant: string | null;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
  loginHint?: string | null;
}

/** Build the IdP authorization URL (response_type=code, PKCE, offline access). */
export function buildAuthorizeUrl(input: AuthorizeUrlInput): string {
  const ep = OAUTH_PROVIDERS[input.provider];
  const url = new URL(ep.authorizeUrl(input.tenant));
  const p = url.searchParams;
  p.set("client_id", input.clientId);
  p.set("response_type", "code");
  p.set("redirect_uri", input.redirectUri);
  p.set("scope", input.scope || ep.defaultScope);
  p.set("state", input.state);
  p.set("code_challenge", input.codeChallenge);
  p.set("code_challenge_method", "S256");
  if (input.loginHint) p.set("login_hint", input.loginHint);
  if (input.provider === "google") {
    p.set("access_type", "offline"); // required for a refresh token
    p.set("prompt", "consent"); // force consent so a refresh token is (re)issued
    p.set("include_granted_scopes", "true");
  } else {
    p.set("response_mode", "query");
  }
  return url.toString();
}

export interface CodeExchangeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

/** Build the token-endpoint POST body for the authorization_code exchange. */
export function buildCodeExchangeBody(input: CodeExchangeInput): URLSearchParams {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", input.clientId);
  body.set("client_secret", input.clientSecret);
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUri);
  body.set("code_verifier", input.codeVerifier);
  return body;
}

/**
 * Read the mailbox address from an OIDC id_token. No signature check — it comes
 * straight back from the IdP token endpoint over TLS (a confidential server-side
 * exchange), so the channel is the trust anchor. Returns null when absent.
 */
export function decodeIdTokenEmail(idToken: string | null | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const claims = JSON.parse(json) as Record<string, unknown>;
    const email = claims.email ?? claims.preferred_username ?? claims.upn;
    return typeof email === "string" && email.includes("@")
      ? email.trim().toLowerCase()
      : null;
  } catch {
    return null;
  }
}
