"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { requireRole, auditActor } from "@/lib/auth/session";
import { saveRequire2fa } from "@/lib/services/app-settings";
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  disableTotp,
  regenerateBackupCodes,
} from "@/lib/services/totp";
import { otpauthUrl } from "@/lib/auth/totp";
import { getAppSettings } from "@/lib/services/app-settings";
import { getFormString as str } from "@/lib/forms";
import type { AuditContext } from "@/lib/audit/audit";

export interface SecurityState {
  error?: string;
  message?: string;
  /** Active enrollment: the pending secret + its otpauth URL, shown to scan. */
  enrolling?: { secret: string; otpauthUrl: string };
  /** One-time backup codes to display (after confirm / regenerate). */
  backupCodes?: string[];
}

async function selfActor(userId: string, email: string | null): Promise<AuditContext> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  return {
    ...(await auditActor()),
    actorId: userId,
    actorEmail: email,
    ip: xff ? xff.split(",")[0]?.trim() ?? null : null,
    userAgent: h.get("user-agent"),
  };
}

/**
 * Self-service: any logged-in staff member manages their OWN 2FA. requireRole
 * "viewer" is just "must be a real, active, stamp-valid session" — there is no
 * capability for managing your own credentials.
 */

/** Step 1: generate (or rotate) a pending secret and return it to scan. */
export async function startEnrollment(
  _prev: SecurityState,
  _formData: FormData,
): Promise<SecurityState> {
  const { dbUser } = await requireRole("viewer");
  if (dbUser.totpConfirmedAt) {
    return { error: "Two-factor authentication is already enabled." };
  }
  const { secret } = await beginTotpEnrollment(dbUser.id);
  const app = await getAppSettings();
  return {
    enrolling: {
      secret,
      otpauthUrl: otpauthUrl(secret, dbUser.email, app.businessName),
    },
  };
}

/** Step 2: confirm a live code; on success, return the one-time backup codes. */
export async function confirmEnrollment(
  _prev: SecurityState,
  formData: FormData,
): Promise<SecurityState> {
  const { dbUser } = await requireRole("viewer");
  const code = str(formData, "code");
  if (!code) return { error: "Enter the 6-digit code from your app." };

  const result = await confirmTotpEnrollment(
    dbUser.id,
    code,
    await selfActor(dbUser.id, dbUser.email),
  );
  if (!result.ok) {
    // Keep showing the enrollment panel so the user can retry the code.
    const app = await getAppSettings();
    const secret = str(formData, "secret");
    return {
      error: result.error,
      enrolling: secret
        ? { secret, otpauthUrl: otpauthUrl(secret, dbUser.email, app.businessName) }
        : undefined,
    };
  }
  revalidatePath("/settings/security");
  return { message: "Two-factor authentication enabled.", backupCodes: result.backupCodes };
}

/** Disable 2FA — requires a current TOTP or backup code (re-auth). */
export async function disableTwoFactor(
  _prev: SecurityState,
  formData: FormData,
): Promise<SecurityState> {
  const { dbUser } = await requireRole("viewer");
  const code = str(formData, "code");
  if (!code) return { error: "Enter a current code to confirm." };

  const result = await disableTotp(
    dbUser.id,
    code,
    await selfActor(dbUser.id, dbUser.email),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/settings/security");
  return { message: "Two-factor authentication disabled." };
}

/** Regenerate backup codes (invalidating the old set). Returns the new codes. */
export async function regenerateCodes(
  _prev: SecurityState,
  _formData: FormData,
): Promise<SecurityState> {
  const { dbUser } = await requireRole("viewer");
  const result = await regenerateBackupCodes(
    dbUser.id,
    await selfActor(dbUser.id, dbUser.email),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/settings/security");
  return { message: "New backup codes generated.", backupCodes: result.backupCodes };
}

/**
 * Owner-only: toggle org-wide 2FA enforcement. When ON, unenrolled staff are
 * forced to enroll at login. requireRole("owner") is a hard floor — this is not
 * a configurable capability. Audited in saveRequire2fa.
 */
export async function setRequire2fa(formData: FormData): Promise<void> {
  const { dbUser } = await requireRole("owner");
  const require2fa = str(formData, "require2fa") === "on";
  await saveRequire2fa(require2fa, {
    ...(await auditActor()),
    actorId: dbUser.id,
    actorEmail: dbUser.email,
  });
  revalidatePath("/settings/security");
}
