# Public marketing site + resident portal hostname

This app can serve **two faces from one install**, split by hostname at your reverse proxy:

| Hostname | Serves |
|---|---|
| `manage.<your-domain>` (staff host = `APP_URL`) | the staff console + staff SSO login |
| `<your-domain>` (public apex) | the marketing **splash** (`/welcome`), the resident portal (`/portal`), the payer portal (`/payer-portal`), the public application form (`/apply`), and `/privacy` + `/terms` |

The splash is a feature **module** (Settings → Modules → "Public website"); its copy lives in
**Settings → Public site**. The app does **no** host routing itself — your proxy maps hostnames to
paths, and the app's pages are already auth-gated (staff routes require a session regardless).

## 1. DNS

Point the public apex at the box running your reverse proxy, e.g.:

```
newedgerentals.com.      A     <your-proxy-public-ip>
# (the staff host manage.newedgerentals.com is already set up)
```

## 2. Caddy

Add a site block for the public apex **beside** your existing staff block. Caddy auto-issues a
real Let's Encrypt certificate once DNS resolves (this also clears any browser cert warning —
the public brand gets a trusted cert).

```caddyfile
# Public brand: splash + resident/payer portals + apply (default-deny everything else)
newedgerentals.com {
    # Splash lives at the app's /welcome route, but the address bar stays "/"
    @root path /
    rewrite @root /welcome

    # Only public-facing paths are exposed on the public brand
    @public path / /welcome /welcome/* /apply /apply/* /portal /portal/* /payer-portal /payer-portal/* \
                  /privacy /terms /sign /sign/* /sms-opt-in /api/portal/* \
                  /_next/* /favicon.ico /icon /robots.txt
    handle @public {
        reverse_proxy property-manager:3000
    }
    # The staff console is NOT exposed on the public brand — bounce stray paths home
    handle {
        redir https://newedgerentals.com/ 302
    }
}

# Staff console — your EXISTING block, unchanged
manage.newedgerentals.com {
    reverse_proxy property-manager:3000
}
```

Notes:
- `property-manager:3000` is the app's upstream on your Caddy Docker network (the alias from
  `docker-compose.caddy.yml`). Adjust if yours differs.
- `/welcome/*` covers the marketing **photos** (hero + gallery), which are served publicly at
  `/welcome/photo/<id>` — only documents you uploaded as public-site images are served there.
- The `@public` allowlist is **default-deny**: anything not listed (e.g. `/dashboard`,
  `/settings`, `/login`) is bounced back to the splash, so the staff console never appears on the
  public brand. Staff routes are also session-gated, so this is defense-in-depth, not the only
  gate.
- Reload Caddy after editing (`caddy reload` / `docker exec <caddy> caddy reload ...`).

## 3. App configuration

1. **Settings → Modules** → turn on **"Public website"**. (Off → the public root redirects to the
   resident login, so the hostname still works before you launch the splash.)
2. **Settings → Public site** → set:
   - **Public site address** = `https://newedgerentals.com`. Tenant-portal **invite & password-
     reset links** are generated against this, so residents get on-brand
     `https://newedgerentals.com/portal/...` links instead of the staff host. Blank = fall back to
     `APP_URL`.
   - Headline, intro blurb, **amenities** (one per line), areas served, office hours.
   - A **hero/banner image** and a **photo gallery** — uploaded right here; served publicly at
     `/welcome/photo/<id>` (allowed by the `@public /welcome/*` rule above).
   - **Show current availability** (optional toggle) — lists your currently-vacant units
     (beds/baths/rent/available date, no floor plans) with an Apply link, pulled live from your
     data. Leave off to keep the site marketing-only.
3. Logo, business name, brand color, phone/email/address come from **Settings → Organization**;
   privacy & terms come from **Settings → Messaging → Compliance** (already rendered at `/privacy`
   and `/terms`).

## 4. Verify

- `https://newedgerentals.com/` → the splash (Apply / Resident / Payer buttons, areas, hours,
  contact, privacy/terms footer).
- `https://newedgerentals.com/portal` → resident login; `…/payer-portal` → payer login;
  `…/apply` → application form.
- Hero/gallery **photos load** (served from `/welcome/photo/...`); if you enabled "Show current
  availability", currently-vacant units appear with Apply links.
- `https://newedgerentals.com/dashboard` → bounced to the splash (staff console not exposed here).
- `https://manage.newedgerentals.com/` → staff console, unchanged.
- Send a tenant portal invite and confirm the link host is `newedgerentals.com`.
