"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma/client";
import type { Role } from "@/lib/generated/prisma/enums";
import { auditActor, requireCapability } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/auth/crypto";
import {
  CLIENT_SECRET_AAD,
  invalidateAuthSettingsCache,
} from "@/lib/auth/settings";
import { writeAudit } from "@/lib/audit/audit";
import { disableBreakGlass } from "@/lib/auth/breakglass";
import { testOidcConnection, type OidcTestResult } from "@/lib/auth/oidc-test";

export interface SaveState {
  ok?: boolean;
  error?: string;
}

export async function saveOidcSettings(
  _prev: SaveState,
  formData: FormData,
): Promise<SaveState> {
  const { user } = await requireCapability("auth.settings");
  // A break-glass session is the IdP bypass; once OIDC has actually been used
  // (any Account row exists) it must NOT be able to repoint auth. Before that —
  // the first-run bootstrap — break-glass is the only session that can exist,
  // so it is allowed to perform the initial configuration.
  if (user.viaBreakGlass && (await prisma.account.count()) > 0) {
    return {
      error:
        "Authentication settings cannot be changed during a break-glass session. Sign in via your IdP first.",
    };
  }

  const issuer = String(formData.get("issuer") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const newSecret = String(formData.get("clientSecret") ?? ""); // write-only; blank = keep
  const scopes =
    String(formData.get("scopes") ?? "").trim() || "openid email profile";
  const enabled = formData.get("enabled") === "on";
  const allowOwnerFromGroup = formData.get("allowOwnerFromGroup") === "on";

  let groupMappings: Record<string, Role>;
  try {
    groupMappings = JSON.parse(
      String(formData.get("groupMappings") ?? "{}") || "{}",
    ) as Record<string, Role>;
  } catch {
    return { error: "Group mappings must be valid JSON, e.g. {\"managers\":\"manager\"}." };
  }

  if (enabled && (!issuer || !clientId)) {
    return { error: "Issuer and Client ID are required to enable OIDC." };
  }

  const fields: Prisma.AuthSettingsUncheckedUpdateInput = {
    oidcEnabled: enabled,
    oidcIssuer: issuer || null,
    oidcClientId: clientId || null,
    oidcScopes: scopes,
    groupMappings: groupMappings as Prisma.InputJsonValue,
    allowOwnerFromGroup,
    updatedBy: user.id,
  };

  if (newSecret) {
    const enc = encryptSecret(newSecret, CLIENT_SECRET_AAD);
    fields.oidcClientSecretCiphertext = enc.ciphertext;
    fields.oidcClientSecretNonce = enc.nonce;
    fields.oidcClientSecretTag = enc.tag;
    fields.oidcSecretKeyVersion = 1;
  }

  await prisma.authSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      ...(fields as Prisma.AuthSettingsUncheckedCreateInput),
    },
    update: fields,
  });
  invalidateAuthSettingsCache();

  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "auth_settings.updated",
    entityType: "AuthSettings",
    entityId: "singleton",
    after: {
      enabled,
      issuer,
      clientId,
      scopes,
      secretChanged: !!newSecret,
      allowOwnerFromGroup,
    },
  });

  revalidatePath("/settings/auth");
  return { ok: true };
}

export async function testConnectionAction(
  _prev: OidcTestResult,
  formData: FormData,
): Promise<OidcTestResult> {
  await requireCapability("auth.settings");
  const issuer = String(formData.get("issuer") ?? "").trim();
  if (!issuer) return { ok: false, error: "Enter an issuer URL first." };
  return testOidcConnection(issuer);
}

export async function disableBreakGlassAction(
  _formData: FormData,
): Promise<void> {
  const { user, dbUser } = await requireCapability("auth.settings");
  await disableBreakGlass(`manual by ${dbUser.email}`);
  await writeAudit(prisma, {
    ...(await auditActor()),
    action: "breakglass.disabled.manual",
    entityType: "BreakGlassCredential",
    actorId: user.id,
  });
  revalidatePath("/settings/auth");
}
