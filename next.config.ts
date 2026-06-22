import type { NextConfig } from "next";

/**
 * Security response headers applied to every route. These are baseline
 * hardening (clickjacking, MIME-sniffing, referrer leakage, feature access)
 * and reduce the "deceptive content" signals browser Safe Browsing weighs —
 * they do NOT, on their own, clear an existing Safe Browsing classification
 * (that needs a Search Console review; see docs/SAFE_BROWSING.md). HSTS is
 * emitted only in production so local plain-HTTP dev isn't pinned to HTTPS;
 * the TLS-terminating proxy forwards it to the browser over HTTPS.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Same-origin framing only — blocks clickjacking / UI-redress phishing.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  // Conservative CSP: lock framing + base-uri + form targets without
  // constraining script/style (a strict script-src would need nonces and risk
  // breaking the app). form-action 'self' stops a hijacked form from posting
  // credentials to an attacker origin — a classic deceptive-site vector.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // Keep native / Prisma packages out of the server bundle.
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "argon2",
  ],
  experimental: {
    // Server-action posts default to a 1 MB body cap, which rejected logo /
    // .docx-template uploads (both validated app-side at 2 MB) with a bare 413
    // error page before any action code ran. 4 MB covers the 2 MB caps plus
    // multipart overhead; /api/uploads (15 MB) is a route handler and was
    // never affected by this limit.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
