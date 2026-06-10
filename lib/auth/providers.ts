import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { getAuthSettings } from "@/lib/auth/settings";
import { verifyBreakGlass } from "@/lib/auth/breakglass";

interface OidcProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  picture?: string;
}

/**
 * Build the provider list from resolved settings. Node runtime only (reads the DB).
 * Used by the lazy NextAuth config in auth.ts — NOT by the edge middleware instance.
 */
export async function buildProviders(): Promise<Provider[]> {
  const settings = await getAuthSettings();
  const providers: Provider[] = [];

  if (
    settings.oidcEnabled &&
    settings.issuer &&
    settings.clientId &&
    settings.clientSecret
  ) {
    providers.push({
      id: "authentik",
      name: "Authentik",
      type: "oidc",
      issuer: settings.issuer,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      authorization: { params: { scope: settings.scopes } },
      checks: ["pkce", "state"],
      // Single trusted IdP (Authentik verifies email): link an Authentik login to
      // the pre-created owner / existing user by email. Documented in docs/AUTHENTIK.md.
      allowDangerousEmailAccountLinking: true,
      profile(profile: OidcProfile) {
        return {
          id: profile.sub,
          name: profile.name ?? profile.preferred_username ?? null,
          email: profile.email ?? null,
          image: profile.picture ?? null,
        };
      },
    } as Provider);
  }

  if (settings.breakGlassEnabled) {
    providers.push(
      Credentials({
        id: "break-glass",
        name: "Emergency access",
        credentials: {
          passphrase: { label: "Passphrase", type: "password" },
        },
        async authorize(credentials, request) {
          const passphrase =
            typeof credentials?.passphrase === "string"
              ? credentials.passphrase
              : "";
          if (!passphrase) return null;
          return verifyBreakGlass(passphrase, request);
        },
      }),
    );
  }

  return providers;
}
