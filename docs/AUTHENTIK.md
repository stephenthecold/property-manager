# Authentik (OIDC) setup

The app signs users in via **Authentik** using standard OIDC. You can run Authentik in the
bundled Compose profile, or point at an existing/remote Authentik (recommended for production
— it's heavy, ~1–1.5 GB across its four containers).

## 1. Start Authentik (bundled, optional)

```bash
# set AUTHENTIK_SECRET_KEY and AUTHENTIK_PG_PASS in .env first
docker compose --profile idp up -d
```

Authentik comes up on `http://localhost:9000` (server + worker + its own Postgres + Redis,
separate from the app DB). Complete its initial admin setup at `/if/flow/initial-setup/`.

## 2. Create an OAuth2/OIDC provider + application in Authentik

In the Authentik admin:

1. **Providers → Create → OAuth2/OpenID Provider**
   - Client type: **Confidential**
   - Redirect URI: `https://<your-app-host>/api/auth/callback/authentik`
   - Signing key: default; scopes: `openid`, `email`, `profile` (add a **groups** scope
     mapping if you want group→role mapping — see step 4).
2. **Applications → Create**, bind it to the provider, note the **slug**.
3. Copy the **Client ID** and **Client Secret**.

The OIDC **issuer** is per-application:
`https://<authentik-host>/application/o/<app-slug>/`
(discovery is served at `…/application/o/<app-slug>/.well-known/openid-configuration`).

## 3. Configure the app

Sign in to Property Manager via **emergency access** (see below) the first time, then go to
**Settings → Authentication** and enter:

- **Issuer**: `https://<authentik-host>/application/o/<app-slug>/`
- **Client ID** / **Client Secret** (the secret is stored AES-256-GCM-encrypted; it is never
  shown again — leave blank to keep)
- Click **Test connection** (validates discovery and that `issuer` matches), then **Save** and
  enable OIDC.

Now `Sign in with Authentik` works. The first OIDC login links to the pre-created owner by
email (single trusted IdP), and break-glass auto-disables once a real OIDC owner logs in.

## 4. Roles from groups (optional)

By default, roles come from the local DB (`owner/admin/manager/viewer`). To provision roles
from Authentik groups:

- Add a **scope mapping** in Authentik so the `groups` claim is included in the **ID token**
  (the app only trusts groups from the verified id_token, never from userinfo).
- In **Settings → Authentication**, set **Group → role mappings**, e.g.
  `{"managers":"manager","admins":"admin"}`.
- `owner` is never granted from a group unless you explicitly enable "allow owner from group".
- Mapping only **raises** a still-default (`viewer`) user on first login; it never downgrades,
  and the local DB role remains authoritative thereafter.

## Common pitfalls

- **Issuer path** must be the per-application `…/application/o/<slug>/`, not the host root.
- **Redirect URI** host must match your external `APP_URL` (behind a proxy, set `APP_URL` and
  `AUTH_TRUST_HOST=true`).
- Changing the issuer/client logs users out — keep break-glass available as a recovery path.
