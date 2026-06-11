/** Utilities a landlord can mark as paid-by-owner on a lease (informational). */
export const UTILITY_OPTIONS = [
  "water",
  "sewer",
  "trash",
  "electric",
  "gas",
  "heat",
] as const;

export type UtilityOption = (typeof UTILITY_OPTIONS)[number];

export function sanitizeUtilities(values: string[]): UtilityOption[] {
  const allowed = new Set<string>(UTILITY_OPTIONS);
  return [...new Set(values)].filter((v): v is UtilityOption => allowed.has(v));
}
