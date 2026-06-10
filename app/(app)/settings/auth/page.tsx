import { prisma } from "@/lib/db";
import { getAuthSettings } from "@/lib/auth/settings";
import { requireRole } from "@/lib/auth/session";
import { AuthSettingsForm } from "./auth-form";

export const runtime = "nodejs";

export default async function AuthSettingsPage() {
  const { user } = await requireRole("owner");
  const [row, resolved] = await Promise.all([
    prisma.authSettings.findUnique({ where: { id: "singleton" } }),
    getAuthSettings(),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <h1 className="mb-1 text-2xl font-semibold">Authentication</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Configure Authentik (OIDC) sign-in and manage break-glass emergency access.
      </p>
      <AuthSettingsForm
        viaBreakGlass={!!user.viaBreakGlass}
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
