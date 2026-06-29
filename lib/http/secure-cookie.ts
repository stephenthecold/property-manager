/**
 * Decide the `Secure` flag for a session cookie from the request signals. PURE —
 * no I/O, unit-tested. The request-scoped reader lives in
 * `lib/http/base-url.ts` (`secureCookie`).
 *
 * Keying `Secure` off NODE_ENV alone is a footgun: a self-host that runs behind
 * a TLS-terminating reverse proxy WITHOUT setting NODE_ENV=production would ship
 * the opaque session bearer token over a NON-Secure cookie. So instead:
 *  - if the proxy told us the scheme (`x-forwarded-proto`), trust it — Secure iff
 *    the client connection is https;
 *  - otherwise (no proxy header) never force Secure on a localhost host (dev over
 *    plain http would otherwise have the browser DROP the cookie), and fall back
 *    to NODE_ENV=production for any other direct host.
 */
export function shouldSecureCookie(opts: {
  forwardedProto: string | null;
  host: string | null;
  isProduction: boolean;
}): boolean {
  // x-forwarded-proto may be a comma list ("https, http") — the client-facing
  // scheme is the first entry.
  const proto = opts.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (proto) return proto === "https";
  if (opts.host && /^(localhost|127\.|\[?::1)/i.test(opts.host)) return false;
  return opts.isProduction;
}
