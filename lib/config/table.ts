/**
 * DataTable page-size options + the org-configurable default. Pure, DB-free —
 * shared by the client `DataTable` (the dropdown options) and the AppSettings
 * resolve layer (clamps the saved org default to a valid option). Keeping the
 * options here means the configurable default can never drift out of the set
 * the dropdown actually offers.
 */

export const TABLE_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export type TablePageSize = (typeof TABLE_PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_TABLE_PAGE_SIZE: TablePageSize = 10;

/** Clamp an arbitrary stored value to one of the offered options (else 10). */
export function sanitizeTablePageSize(
  value: number | null | undefined,
): TablePageSize {
  return TABLE_PAGE_SIZE_OPTIONS.includes(value as TablePageSize)
    ? (value as TablePageSize)
    : DEFAULT_TABLE_PAGE_SIZE;
}
