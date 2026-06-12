"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { createPortalSession } from "@/lib/portal/session";
import {
  loginWithCode,
  loginWithPassword,
  requestLoginCode,
  requestPasswordReset,
  type PortalAuthFailure,
} from "@/lib/services/portal-auth";

/**
 * Public portal-login actions. Failures are RETURNED as state (never thrown);
 * messages stay generic so the form can't be used to probe which emails or
 * phone numbers have accounts.
 */

export interface PortalLoginState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Step marker for the SMS-code flow: code requested, show the code input. */
  codeSent?: boolean;
}

const FAILURE_MESSAGES: Record<PortalAuthFailure, string> = {
  module_disabled: "The tenant portal is currently unavailable.",
  invalid_link: "This link is invalid or has expired.",
  weak_password: "Password must be at least 8 characters.",
  bad_credentials: "That email/phone and password combination didn't match.",
  locked: "Too many attempts — this account is locked for 15 minutes.",
  code_expired: "That code has expired — request a new one.",
  code_invalid: "That code didn't match. Check the latest text and try again.",
  resend_cooldown: "A code was just sent — wait a minute before requesting another.",
  sms_unavailable: "Text messages aren't available right now — try the password option or contact your property manager.",
};

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  return {
    ip: clientIpFromXff(h.get("x-forwarded-for")),
    userAgent: h.get("user-agent"),
  };
}

export async function portalPasswordLoginAction(
  _prev: PortalLoginState,
  fd: FormData,
): Promise<PortalLoginState> {
  const identifier = String(fd.get("identifier") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!identifier || !password) {
    return { error: "Enter your email or phone and your password." };
  }
  let result: Awaited<ReturnType<typeof loginWithPassword>>;
  try {
    result = await loginWithPassword({ identifier, password });
  } catch (e) {
    console.error("[portal] password login failed:", e);
    return { error: "Something went wrong — please try again." };
  }
  if (!result.ok) return { error: FAILURE_MESSAGES[result.code] };
  const meta = await requestMeta();
  await createPortalSession(result.accountId, meta.ip, meta.userAgent);
  redirect("/portal");
}

export async function portalRequestCodeAction(
  _prev: PortalLoginState,
  fd: FormData,
): Promise<PortalLoginState> {
  const phone = String(fd.get("phone") ?? "").trim();
  if (!phone) return { error: "Enter your phone number." };
  try {
    const result = await requestLoginCode({ phone });
    if (!result.ok) return { error: FAILURE_MESSAGES[result.code] };
  } catch (e) {
    console.error("[portal] code request failed:", e);
    return { error: "Something went wrong — please try again." };
  }
  return {
    codeSent: true,
    message: "If that number has a portal account, a 6-digit code is on its way.",
  };
}

export async function portalCodeLoginAction(
  _prev: PortalLoginState,
  fd: FormData,
): Promise<PortalLoginState> {
  const phone = String(fd.get("phone") ?? "").trim();
  const code = String(fd.get("code") ?? "").trim();
  if (!phone || !code) {
    return { codeSent: true, error: "Enter the 6-digit code from the text." };
  }
  let result: Awaited<ReturnType<typeof loginWithCode>>;
  try {
    result = await loginWithCode({ phone, code });
  } catch (e) {
    console.error("[portal] code login failed:", e);
    return { codeSent: true, error: "Something went wrong — please try again." };
  }
  if (!result.ok) return { codeSent: true, error: FAILURE_MESSAGES[result.code] };
  const meta = await requestMeta();
  await createPortalSession(result.accountId, meta.ip, meta.userAgent);
  redirect("/portal");
}

export async function portalForgotPasswordAction(
  _prev: PortalLoginState,
  fd: FormData,
): Promise<PortalLoginState> {
  const identifier = String(fd.get("identifier") ?? "").trim();
  if (!identifier) return { error: "Enter your email or phone number." };
  try {
    await requestPasswordReset({ identifier });
  } catch (e) {
    console.error("[portal] password reset request failed:", e);
  }
  // Always generic — never confirm whether an account exists.
  return {
    ok: true,
    message:
      "If that matches a portal account, a reset link is on its way by text and email.",
  };
}
