import "server-only";
import dns from "node:dns/promises";

/**
 * Validate an OIDC issuer by fetching its discovery document. Owner-authenticated
 * use only. Blocks link-local / cloud-metadata addresses (SSRF); internal Docker
 * hostnames are intentionally allowed since self-hosted Authentik is often internal.
 */
export interface OidcTestResult {
  ok: boolean;
  issuer?: string;
  error?: string;
  endpoints?: {
    authorization?: string;
    token?: string;
    userinfo?: string;
    jwks?: string;
  };
}

function isBlockedAddress(ip: string): boolean {
  // link-local (incl. 169.254.169.254 cloud metadata) and IPv6 link-local
  return ip.startsWith("169.254.") || ip.toLowerCase().startsWith("fe80:");
}

export async function testOidcConnection(
  issuerRaw: string,
): Promise<OidcTestResult> {
  let url: URL;
  try {
    url = new URL(issuerRaw);
  } catch {
    return { ok: false, error: "Invalid issuer URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Issuer must use http or https." };
  }

  try {
    const addrs = await dns.lookup(url.hostname, { all: true });
    if (addrs.some((a) => isBlockedAddress(a.address))) {
      return { ok: false, error: "Issuer host resolves to a blocked address range." };
    }
  } catch {
    // Hostname not resolvable from here (e.g. compose-internal name) — allow.
  }

  const discoveryUrl = `${issuerRaw.replace(/\/$/, "")}/.well-known/openid-configuration`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(discoveryUrl, { signal: ctrl.signal, redirect: "error" });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, error: `Discovery returned HTTP ${res.status}.` };
    }
    const doc = (await res.json()) as Record<string, string>;
    const norm = (s: string) => s.replace(/\/$/, "");
    if (doc.issuer && norm(doc.issuer) !== norm(url.href)) {
      return {
        ok: false,
        error: `Discovery 'issuer' (${doc.issuer}) does not match the configured issuer.`,
      };
    }
    return {
      ok: true,
      issuer: doc.issuer,
      endpoints: {
        authorization: doc.authorization_endpoint,
        token: doc.token_endpoint,
        userinfo: doc.userinfo_endpoint,
        jwks: doc.jwks_uri,
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Discovery fetch failed.",
    };
  }
}
