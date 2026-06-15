/**
 * Pure inbound-SMS keyword classification (DB-free) — unit-tested.
 *
 * Carrier A2P/10DLC requires honoring STOP/START/HELP. We classify the first
 * word of an inbound message; anything else is a normal reply we don't act on.
 * Matching is case-insensitive and tolerant of trailing punctuation.
 */

export type SmsKeyword = "stop" | "start" | "help" | "none";

// Standard CTIA opt-out / opt-in / help keywords.
const STOP = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
  "REVOKE",
]);
const START = new Set(["START", "YES", "UNSTOP", "OPTIN", "SUBSCRIBE"]);
const HELP = new Set(["HELP", "INFO"]);

export function classifyKeyword(body: string | null | undefined): SmsKeyword {
  // First whitespace-delimited token, uppercased, trailing punctuation stripped.
  const first = (body ?? "")
    .trim()
    .split(/\s+/)[0]
    ?.toUpperCase()
    .replace(/[.!,?]+$/, "");
  if (!first) return "none";
  if (STOP.has(first)) return "stop";
  if (START.has(first)) return "start";
  if (HELP.has(first)) return "help";
  return "none";
}
