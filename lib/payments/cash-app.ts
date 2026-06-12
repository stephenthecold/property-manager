/**
 * Cash App cashtag helpers — pure string logic. Cash App has NO public API
 * for reading account activity, so support is: show the org cashtag/link in
 * notices and the tenant portal, and record incoming payments manually with
 * method "cash_app" + the transaction reference.
 */

/** Cashtags: 1–20 chars, must start with a letter; letters/digits/_/./- after. */
const CASHTAG_BODY_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,19}$/;

/**
 * Canonical "$Cashtag" from operator input ("tag", "$tag", " $Tag ") or null
 * when empty/invalid. Stored canonical so templates/links never re-normalize.
 */
export function normalizeCashtag(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? "").trim().replace(/^\$/, "");
  if (trimmed === "") return null;
  if (!CASHTAG_BODY_RE.test(trimmed)) return null;
  return `$${trimmed}`;
}

/** Payment link for a canonical "$Cashtag". */
export function cashAppLink(cashtag: string): string {
  return `https://cash.app/${cashtag}`;
}
