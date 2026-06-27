import { prisma } from "@/lib/db";
import { getAuthSettings } from "@/lib/auth/settings";
import { requireCapability } from "@/lib/auth/session";
import { AuthSettingsForm } from "./auth-form";
import { Card, CardContent } from "@/components/ui/card";

export const runtime = "nodejs";

export default async function AuthSettingsPage() {
  const { user } = await requireCapability("auth.settings");
  const [row, resolved, oidcAccountCount] = await Promise.all([
    prisma.authSettings.findUnique({ where: { id: "singleton" } }),
    getAuthSettings(),
    prisma.account.count(),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Authentication</h2>
        <p className="text-sm text-muted-foreground">
          Configure Authentik (OIDC) sign-in and manage break-glass emergency access.
        </p>
      </div>
      <Card>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
