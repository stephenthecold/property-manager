import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/config/env";
import { decryptSecret } from "@/lib/auth/crypto";
import type { Role } from "@/lib/generated/prisma/enums";

/** AAD binding the encrypted client secret to its row/field (GCM transplant protection). */
export const CLIENT_SECRET_AAD = "authsettings:clientSecret:singleton";

export interface ResolvedAuthSettings {
  oidcEnabled: boolean;
  issuer?: string;
  clientId?: string;
  /** Decrypted — server-only, NEVER serialized to the client. */
  clientSecret?: string;
  scopes: string;
  groupMappings: Record<string, Role>;
  allowOwnerFromGroup: boolean;
  breakGlassEnabled: boolean;
  source: "db" | "env" | "disabled";
}

let cache: { value: ResolvedAuthSettings; at: number } | null = null;
const TTL_MS = 30_000;

export function invalidateAuthSettingsCache(): void {
  cache = null;
}

export async function getAuthSettings(): Promise<ResolvedAuthSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = await resolve();
  cache = { value, at: Date.now() };
  return value;
}

async function resolve(): Promise<ResolvedAuthSettings> {
  const env = getEnv();
  const row = await prisma.authSettings.findUnique({
    where: { id: "singleton" },
  });
  const now = new Date();

  const dbBreakGlass =
    !!row?.breakGlassEnabled &&
    (!row.breakGlassExpiresAt || row.breakGlassExpiresAt > now);
  const breakGlassEnabled = dbBreakGlass || env.BREAK_GLASS;

  const groupMappings = (row?.groupMappings as Record<string, Role>) ?? {};

  // DB config wins when fully configured and enabled.
  if (
    row?.oidcEnabled &&
    row.oidcIssuer &&
    row.oidcClientId &&
    row.oidcClientSecretCiphertext &&
    row.oidcClientSecretNonce &&
    row.oidcClientSecretTag
  ) {
    const clientSecret = decryptSecret(
      {
        ciphertext: row.oidcClientSecretCiphertext,
        nonce: row.oidcClientSecretNonce,
        tag: row.oidcClientSecretTag,
      },
      CLIENT_SECRET_AAD,
    );
    return {
      oidcEnabled: true,
      issuer: row.oidcIssuer,
      clientId: row.oidcClientId,
      clientSecret,
      scopes: row.oidcScopes,
      groupMappings,
      allowOwnerFromGroup: row.allowOwnerFromGroup,
      breakGlassEnabled,
      source: "db",
    };
  }

  // Env fallback (bootstrap / CI).
  if (env.AUTHENTIK_ISSUER && env.AUTHENTIK_CLIENT_ID && env.AUTHENTIK_CLIENT_SECRET) {
    return {
      oidcEnabled: true,
      issuer: env.AUTHENTIK_ISSUER,
      clientId: env.AUTHENTIK_CLIENT_ID,
      clientSecret: env.AUTHENTIK_CLIENT_SECRET,
      scopes: env.OIDC_SCOPES,
      groupMappings,
      allowOwnerFromGroup: env.ALLOW_OWNER_FROM_GROUP || !!row?.allowOwnerFromGroup,
      breakGlassEnabled,
      source: "env",
    };
  }

  return {
    oidcEnabled: false,
    scopes: env.OIDC_SCOPES,
    groupMappings,
    allowOwnerFromGroup: false,
    breakGlassEnabled,
    source: "disabled",
  };
}
