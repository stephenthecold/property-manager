"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { unstable_update } from "@/auth";
import { getSessionUser } from "@/lib/auth/session";
import {
  verifyLoginChallenge,
  confirmTotpEnrollment,
  issueTwoFactorProof,
} from "@/lib/services/totp";
import type { AuditContext } from "@/lib/audit/audit";

export interface TwoFactorState {
  error?: string;
}

export interface EnrollState {
  error?: string;
  /** Set once the code is confirmed — the one-time backup codes to display. */
  backupCodes?: string[];
}

/** Actor context for the 2FA actions (the half-authed user is the actor). */
async function pendingActor(userId: string, email: string | null): Promise<AuditContext> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  return {
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    ip: xff ? xff.split(",")[0]?.trim() ?? null : null,
    userAgent: h.get("user-agent"),
    viaBreakGlass: false,
  };
}

/**
 * Login 2FA challenge: verify a TOTP or backup code for the pending session,
 * then clear the pending flag via auth's update() and continue into the app.
 * Fails closed — a wrong/missing code leaves the session pending. Break-glass
 * never reaches here (it is not pending).
 */
export async function submitTwoFactorChallenge(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const u = await getSessionUser();
  // No session, or already cleared — send to the right place.
  if (!u) redirect("/login");
  if (!u.twoFactorPending) redirect("/dashboard");

  const code = String(formData.get("code") ?? "");
  if (!code.trim()) return { error: "Enter your authentication code." };

  const result = await verifyLoginChallenge(
    u.id,
    code,
    await pendingActor(u.id, u.email ?? null),
  );
  if (!result.ok) {
    return {
      error: result.locked
        ? "Too many incorrect codes. Try again in a few minutes, or use a backup code once the lock clears."
        : "That code is incorrect or expired. Try again.",
    };
  }

  // Clear the pending flag by handing the jwt callback an UNFORGEABLE proof
  // (HMAC bound to this user + their current securityStamp). The jwt callback
  // re-verifies it against the DB stamp before lowering the gate.
  const proof = await issueTwoFactorProof(u.id);
  if (!proof) redirect("/login");
  await unstable_update({ twoFactorProof: proof } as never);
  redirect("/dashboard");
}

/**
 * Forced-enrollment confirm (when require2fa is ON and the user is not yet
 * enrolled): verify the live code against the pending secret and mark enrolled.
 * Returns the one-time backup codes for the user to save; the form then calls
 * finishForcedEnrollment to re-sync the token and continue. Fails closed.
 */
export async function confirmForcedEnrollment(
  _prev: EnrollState,
  formData: FormData,
): Promise<EnrollState> {
  const u = await getSessionUser();
  if (!u) redirect("/login");

  const code = String(formData.get("code") ?? "");
  if (!code.trim()) return { error: "Enter the 6-digit code from your app." };

  const result = await confirmTotpEnrollment(
    u.id,
    code,
    await pendingActor(u.id, u.email ?? null),
  );
  if (!result.ok) return { error: result.error };
  return { backupCodes: result.backupCodes };
}

/**
 * After forced enrollment, the user has saved their backup codes. Re-sync the
 * token (enrollment bumped the security stamp; the jwt update branch re-reads
 * the DB stamp when given a valid proof, so this session stays valid) and
 * continue into the app.
 */
export async function finishForcedEnrollment(): Promise<void> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  // Enrollment bumped the securityStamp; issue the proof against the NEW stamp
  // (issueTwoFactorProof re-reads it) so the jwt callback's DB-stamp check
  // matches and this session stays valid.
  const proof = await issueTwoFactorProof(u.id);
  if (!proof) redirect("/login");
  await unstable_update({ twoFactorProof: proof } as never);
  redirect("/dashboard");
}
