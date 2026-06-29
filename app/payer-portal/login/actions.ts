"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIpFromXff } from "@/lib/http/client-ip";
import { createPayerSession } from "@/lib/payer-portal/session";
import { rateLimitHit, RATE_LIMITS } from "@/lib/services/rate-limit";
import {
  loginPayerWithPassword,
  type PayerAuthFailure,
} from "@/lib/services/payer-portal-auth";

/**
 * Public payer-login action. Failures are RETURNED as state (never thrown);
 * messages stay generic so the form can't probe which emails have accounts.
 */
export interface PayerLoginState {
  ok?: boolean;
  error?: string;
}

const FAILURE_MESSAGES: Record<PayerAuthFailure, string> = {
  module_disabled: "The payer portal is currently unavailable.",
  invalid_link: "This link is invalid or has expired.",
  weak_password: "Password must be at least 8 characters.",
  bad_credentials: "That email and password combination didn't match.",
  locked: "Too many attempts — this account is locked for 15 minutes.",
};

export async function payerPasswordLoginAction(
  _prev: PayerLoginState,
  fd: FormData,
): Promise<PayerLoginState> {
  const h = await headers();
  const ip = clientIpFromXff(h.get("x-forwarded-for"));
  if (!(await rateLimitHit(RATE_LIMITS.authLogin, ip)).allowed) {
    return { error: "Too many attempts — please wait a few minutes and try again." };
  }
  const email = String(fd.get("email") ?? "").trim();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  let result: Awaited<ReturnType<typeof loginPayerWithPassword>>;
  try {
    result = await loginPayerWithPassword({ email, password });
  } catch (e) {
    console.error("[payer-portal] password login failed:", e);
    return { error: "Something went wrong — please try again." };
  }
  if (!result.ok) return { error: FAILURE_MESSAGES[result.code] };

  await createPayerSession(result.accountId, ip, h.get("user-agent"));
  redirect("/payer-portal");
}
