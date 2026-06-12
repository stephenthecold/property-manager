"use server";

import { headers } from "next/headers";
import { getEnv } from "@/lib/config/env";
import { recordSignature, type SignErrorCode } from "@/lib/services/esign";

/**
 * Public signing action — NO session here (/sign is a PUBLIC_PREFIX); the
 * caller is authenticated purely by the link token, which recordSignature
 * validates and resolves by hash. All failures are RETURNED as state.
 */

export interface SignActionState {
  ok?: boolean;
  error?: string;
}

/**
 * Real client IP from x-forwarded-for honoring TRUSTED_PROXY_COUNT: each
 * trusted hop appends the peer it received from, so the trustworthy client
 * entry is the Nth from the END (N = trusted proxies, min 1). Earlier entries
 * are caller-supplied and spoofable.
 */
function clientIpFromXff(xff: string | null): string | null {
  if (!xff) return null;
  const hops = xff
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (hops.length === 0) return null;
  const trusted = Math.min(Math.max(getEnv().TRUSTED_PROXY_COUNT, 1), hops.length);
  return hops[hops.length - trusted] ?? null;
}

const ERROR_MESSAGES: Record<SignErrorCode, string> = {
  invalid: "This signing link is invalid or has expired.",
  expired:
    "This signing link has expired. Please ask your property manager to send a new one.",
  canceled: "This signing request was canceled by the property manager.",
  already_signed: "You have already signed this agreement.",
  consent_required:
    "Please check the consent box to agree to sign electronically.",
  invalid_signature:
    "Please add your signature (typed name up to 120 characters, or a drawing) and try again.",
  storage_unavailable:
    "We couldn't save your signature right now — please try again in a few minutes.",
};

export async function signAction(
  _prev: SignActionState,
  fd: FormData,
): Promise<SignActionState> {
  const token = String(fd.get("token") ?? "");
  const kind = String(fd.get("kind") ?? "") === "drawn" ? "drawn" : "typed";
  const consent = fd.get("consent") === "on" || fd.get("consent") === "true";
  const signatureText = String(fd.get("signatureText") ?? "");
  const signatureImagePngDataUrl = String(fd.get("signatureImage") ?? "");

  const h = await headers();
  const ip = clientIpFromXff(h.get("x-forwarded-for"));
  const userAgent = h.get("user-agent");

  let result: Awaited<ReturnType<typeof recordSignature>>;
  try {
    result = await recordSignature({
      token,
      kind,
      signatureText: signatureText || undefined,
      signatureImagePngDataUrl: signatureImagePngDataUrl || undefined,
      consent,
      ip,
      userAgent,
    });
  } catch (e) {
    console.error("[esign] signAction failed:", e);
    return { error: "Something went wrong — please try again." };
  }

  if (!result.ok) return { error: ERROR_MESSAGES[result.code] };
  return { ok: true };
}
