/**
 * Turn a caught inbox-poll error into an operator-readable message for the
 * Settings → Email inbox health panel.
 *
 * ImapFlow collapses every failed IMAP command to `err.message = "Command
 * failed"` and stashes the actual reason on side fields — `responseText`
 * (the human-readable server text), `serverResponseCode` (e.g.
 * "AUTHENTICATIONFAILED"), `authenticationFailed`, and `code = "ETHROTTLE"`
 * for Microsoft 365 rate-limits. The health panel only ever sees the recorded
 * `inboxLastError` string, so unless we lift those fields into the message an
 * operator just sees "Command failed" with nothing to act on.
 *
 * PURE + duck-typed (no imapflow import), so it's DB-free and unit-tested.
 */

/** ImapFlow error side-fields we read off a caught error (all optional). */
type ImapErrorShape = Error & {
  responseText?: unknown;
  response?: unknown;
  responseStatus?: unknown;
  serverResponseCode?: unknown;
  authenticationFailed?: unknown;
  code?: unknown;
  throttleReset?: unknown;
};

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/**
 * Appended when the error signals an auth/permission rejection. Provider-neutral
 * lead (Gmail and self-hosted IMAP also need IMAP enabled and a re-auth), with
 * the M365-specific app permission scoped to M365 — disabled IMAP / a missing
 * `IMAP.AccessAsUser.All` grant is by far the most common reason a
 * freshly-connected Microsoft 365 mailbox fails to poll.
 */
const AUTH_HINT =
  " — check that IMAP is enabled for this mailbox; for Microsoft 365 the connected app also needs the IMAP.AccessAsUser.All permission. Then reconnect.";

export function describeInboxPollError(err: unknown): string {
  if (!(err instanceof Error)) return String(err ?? "Unknown error");
  const e = err as ImapErrorShape;

  // M365 throttling — ImapFlow tags these distinctly and self-recovers.
  if (e.code === "ETHROTTLE") {
    const secs =
      typeof e.throttleReset === "number" && e.throttleReset > 0
        ? Math.max(1, Math.round(e.throttleReset / 1000))
        : null;
    return `Microsoft 365 is throttling this mailbox${
      secs ? ` (suggested back-off ~${secs}s)` : ""
    }. This usually clears on its own; if it persists, the mailbox is being polled too aggressively.`;
  }

  // The real reason ImapFlow hides behind "Command failed". `response` is an
  // object on a raw command failure but a string once enhanced, so text()
  // accepts it only when it's actually a string.
  const responseText = text(e.responseText) ?? text(e.response);
  const code = text(e.serverResponseCode);
  const status = text(e.responseStatus); // "NO" | "BAD" on a command failure
  const authFailed = e.authenticationFailed === true;

  let msg: string;
  if (authFailed) {
    msg = responseText
      ? `The mail server rejected authentication: ${responseText}`
      : "The mail server rejected authentication";
  } else if (responseText) {
    msg = `The mail server rejected the request: ${responseText}`;
  } else if (status) {
    // A terse NO/BAD with no human text — still beats a bare "Command failed".
    msg = `The mail server rejected the request (${status})`;
  } else {
    // Nothing richer than the generic message available.
    msg = text(err.message) ?? "Inbox poll failed";
  }
  if (code) msg += ` [${code}]`;

  // Auth/permission rejections get the IMAP-enablement hint. The bare
  // "disabled" / "not enabled" signals are scoped to IMAP context so an
  // unrelated "<extension> is disabled" notice doesn't trip it.
  const hay = `${responseText ?? ""} ${code ?? ""}`.toLowerCase();
  const authSignal =
    authFailed ||
    /authenticationfailed|authorizationfailed|invalid_grant|login\s*failed/.test(
      hay,
    ) ||
    (hay.includes("imap") && /disabled|not enabled/.test(hay));
  if (authSignal) {
    msg += AUTH_HINT;
  }
  return msg;
}
