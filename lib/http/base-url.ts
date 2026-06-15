import "server-only";
import { headers } from "next/headers";
import { getEnv } from "@/lib/config/env";

/**
 * Public base URL for links the app GENERATES and shares (trial-login, apply,
 * and e-sign links). In a request context it derives the host from the reverse
 * proxy's forwarded headers, so a generated link matches whatever domain the
 * user is actually on — instead of the APP_URL default (localhost). Outside a
 * request (the worker) or when headers are unavailable it falls back to APP_URL.
 *
 * NOTE: do NOT use this for provider webhook-callback URLs (Twilio status /
 * inbound) — those must stay on the canonical APP_URL so signature
 * verification and the StatusCallback target stay stable.
 */
export async function publicBaseUrl(): Promise<string> {
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ??
        (/^(localhost|127\.|\[?::1)/i.test(host) ? "http" : "https");
      return `${proto}://${host}`.replace(/\/+$/, "");
    }
  } catch {
    // Not in a request scope (e.g. the worker) — fall through to the env default.
  }
  return getEnv().APP_URL.replace(/\/+$/, "");
}
