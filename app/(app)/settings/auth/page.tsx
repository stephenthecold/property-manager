import { prisma } from "@/lib/db";
import { getAuthSettings } from "@/lib/auth/settings";
import { requireRole } from "@/lib/auth/session";
import { AuthSettingsForm } from "./auth-form";

export const runtime = "nodejs";

export default async function AuthSettingsPage() {
  const { user } = await requireRole("owner");
  const [row, resolved, oidcAccountCount] = await Promise.all([
    prisma.authSettings.findUnique({ where: { id: "singleton" } }),
    getAuthSettings(),
    prisma.account.count(),
  ]);

  return (
    <div className="w-full max-w-2xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Authentication</h2>
        <p className="text-sm text-muted-foreground">
          Configure Authentik (OIDC) sign-in and manage break-glass emergency access.
        </p>
      </div>
      <AuthSettingsForm
        viaBreakGlass={!!user.viaBreakGlass}
        authLocked={!!user.viaBreakGlass && oidcAccountCount > 0}
        breakGlassEnabled={resolved.breakGlassEnabled}
        breakGlassExpiresAt={row?.breakGlassExpiresAt?.toISOString() ?? null}
        initial={{
          enabled: row?.oidcEnabled ?? false,
          issuer: row?.oidcIssuer ?? "",
          clientId: row?.oidcClientId ?? "",
          scopes: row?.oidcScopes ?? "openid email profile",
          hasSecret: !!row?.oidcClientSecretCiphertext,
          groupMappings: JSON.stringify(row?.groupMappings ?? {}),
          allowOwnerFromGroup: row?.allowOwnerFromGroup ?? false,
          source: resolved.source,
        }}
      />
    </div>
  );
}
