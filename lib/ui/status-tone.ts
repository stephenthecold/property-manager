/**
 * One source of truth for status-badge tones. Every status/priority map across
 * the app (account status, maintenance lifecycle, reminders, applications, SMS
 * consent, inbox, tenant requests) maps its enum to a `Tone` instead of
 * hand-writing Tailwind tint classes — so the badges stay in lockstep and a
 * tweak lands in exactly one place.
 *
 * Each tone is an outline-Badge surface: a light tint + readable text in both
 * themes, with the canonical dark opacity (`/60`). `neutral` leans on the muted
 * token so it is theme-aware without a hue. Pair with `ToneBadge`
 * (components/status-badge.tsx), or read `TONE_CLASS[tone]` directly when a call
 * site needs extra Badge props (e.g. a title tooltip).
 */
export type Tone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "progress"
  | "hold"
  | "neutral";

export const TONE_CLASS: Record<Tone, string> = {
  success:
    "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  danger:
    "border-red-200 bg-red-100 text-red-800 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300",
  info: "border-sky-200 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  progress:
    "border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  hold: "border-purple-200 bg-purple-100 text-purple-800 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
  neutral: "border-muted bg-muted text-muted-foreground",
};

/** Tailwind classes for a tone — convenience accessor over {@link TONE_CLASS}. */
export function toneClass(tone: Tone): string {
  return TONE_CLASS[tone];
}
