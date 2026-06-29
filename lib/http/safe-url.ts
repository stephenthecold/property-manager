import net from "node:net";

/**
 * Guard for OUTBOUND fetches to an operator-supplied URL (e.g. the inbox OAuth2
 * token endpoint, which the worker POSTs the mailbox client secret + refresh
 * token to). Without this, a `messaging.settings` operator could repoint the URL
 * at an internal service (SSRF) or — combined with the write-only "blank = keep
 * stored secret" semantics — at an attacker host to exfiltrate a secret they
 * cannot otherwise read.
 *
 * Returns a human-readable reason when `raw` is unsafe, or `null` when it is an
 * https:// URL pointing at a public host NAME. The rule is deliberately strict:
 *  - https only;
 *  - reject every IP literal (v4 or v6) — a real OAuth token endpoint is always
 *    a DNS hostname, and raw IPs are the easy SSRF targets (loopback, 10.x,
 *    169.254.169.254 metadata, ::1, IPv4-mapped, …);
 *  - reject localhost / internal-suffix hostnames.
 *
 * PURE — no DNS/network, so it does NOT catch a hostname that resolves to an
 * internal IP (DNS rebinding); for the secret-exfil case it is paired with
 * re-binding the stored secret to its destination at the save layer.
 */
export function unsafeOutboundUrlReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "must be a valid URL.";
  }
  if (url.protocol !== "https:") return "must use https://.";
  // Strip a trailing FQDN dot and IPv6 brackets before classifying the host.
  let host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (net.isIP(host) !== 0) {
    return "must point at a host name, not a raw IP address.";
  }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localdomain")
  ) {
    return "must point at a public host, not a local/internal name.";
  }
  return null;
}
