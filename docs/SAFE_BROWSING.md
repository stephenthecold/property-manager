# Chrome flags the site as "Dangerous" / "Deceptive site ahead"

If Chrome (or Firefox/Safari — they share the feed) shows a **full-page red interstitial** that
says *"Deceptive site ahead"*, *"Dangerous site"*, or *"The site ahead contains malware"* when you
sign in, that is **Google Safe Browsing**. It is a *reputation verdict made by Google*, not a bug
in this app, and **changing app code cannot directly remove it**. This runbook is how you find the
cause and get it cleared.

> First, rule out the look-alikes — the fix is completely different:
>
> | What you see | What it is | Fix |
> |---|---|---|
> | Red **"Your connection is not private"**, `NET::ERR_CERT_*` | Untrusted/self-signed TLS cert | Real cert on a real domain — see [`DEPLOYMENT.md`](DEPLOYMENT.md#tls--reverse-proxy-https-only). Don't use the bundled Caddy's `localhost` default in production. |
> | Address bar **"Not secure"** (no full page) / warning on the password box | Reached over `http://` | Serve over HTTPS behind the proxy; set `APP_URL=https://…`. |
> | Full-page **red "Deceptive/Dangerous site ahead"** | **Safe Browsing** (this doc) | Diagnose + request review, below. |

## Why a clean self-hosted app gets flagged

Safe Browsing is reputation- and signal-based, so a brand-new install with nothing malicious in it
can still trip it. Common reasons, roughly in order:

1. **Fresh / low-reputation domain or hosting IP.** A newly registered domain, or a shared/VPS IP
   whose previous tenant was abused, starts with little or negative reputation. Login pages on such
   hosts are disproportionately flagged as "deceptive."
2. **The external IdP domain.** Staff sign-in redirects to your **Authentik** OIDC domain
   (`docs/AUTHENTIK.md`). If *that* host is flagged, the warning appears mid-login even though the
   app itself is fine. Check the IdP domain separately.
3. **Mixed/insecure auth round-trip.** If the proxy serves HTTPS but `APP_URL`/`AUTH_URL` is
   `http://`, NextAuth can emit `http://` callback URLs, producing insecure-form / mixed-content
   signals during the OIDC hop. Keep `APP_URL` and `AUTH_URL` on `https://` and ensure the proxy
   sets `X-Forwarded-Proto=https`.
4. **A flagged neighbor on the same domain.** Anything else hosted under the same registered domain
   (a parked page, an old app, user content) can taint the whole site.

This repo already removes the *code-side* signals it can: no `eval`, no third-party script
injection, file downloads are `nosniff` + `Content-Disposition`, and `next.config.ts` sets HSTS,
`X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a `frame-ancestors`/`form-action`
CSP. None of that overrides a reputation verdict.

## Diagnose the exact reason (do this first)

1. Open **Google Search Console** (<https://search.google.com/search-console>) and **verify
   ownership** of the domain (DNS TXT record is easiest for a self-hosted box).
2. Go to **Security & Manual Actions → Security Issues**. Google states the specific category
   (Social engineering / Deceptive pages / Malware / Unwanted software) and often sample URLs.
3. Cross-check with the **Safe Browsing site status** page:
   <https://transparencyreport.google.com/safe-browsing/search?url=YOUR_DOMAIN> — run it for both
   the **app domain** and the **Authentik domain** to see which one is actually listed.
4. In Chrome, the interstitial's **"Details"** link names the flagged host — confirm whether it's
   your app or the IdP.

## Remediate, then request a review

1. **Fix the cause** you found above (untrusted cert → real cert; `http://` → HTTPS; flagged IdP →
   clean it / move it; flagged neighbor → remove it; new-domain reputation → there's nothing to
   "fix", you proceed straight to the review request).
2. Make sure the site is reachable over **HTTPS with a valid, publicly-trusted certificate** (Let's
   Encrypt via Caddy on a real domain is the supported path) and that the security headers above
   are being served (`curl -sI https://your-domain | grep -i -E 'strict-transport|x-frame|content-security'`).
3. In Search Console → **Security Issues**, click **Request Review**. Describe what you changed.
   Reviews typically take a few days; the warning lifts automatically once cleared.
4. If the domain has **no** listed issue in Search Console but Chrome still warns, it is almost
   certainly **new-domain/IP reputation**. Options: let reputation build (consistent HTTPS traffic
   on a stable domain helps), move to a domain/host with established reputation, or — for a small
   internal deployment — distribute access over a trusted internal name and instruct staff to
   proceed past the interstitial (the **Details → visit this unsafe site** link) only if they have
   independently confirmed the host is yours.

## What this app does and does not control

- **Controls (already done):** security headers, no risky client code, hardened file serving,
  same-origin form/frame policy.
- **You control (deployment):** a real domain + publicly-trusted TLS cert, `APP_URL`/`AUTH_URL` on
  HTTPS, the reputation of the hosting IP and the Authentik domain, and the Search Console review
  request — which is the only thing that actually lifts a Safe Browsing flag.
