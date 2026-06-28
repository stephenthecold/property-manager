import { sumCents } from "@/lib/money";
import type { Cents } from "@/lib/money";

/**
 * Pure portfolio rollup (module "portfolio"): group per-property financial rows
 * by legal entity (own-LLC grouping) and subtotal each group, plus a grand
 * total across the whole portfolio. DB-free — callers pass already-computed
 * property rows; this only buckets and sums them.
 *
 * Properties whose `legalEntityName` is null/blank fall under a single
 * "Unassigned" group. Grouping is case-insensitive on the trimmed name but the
 * first-seen original spelling is kept as the display label, so "Acme LLC" and
 * "acme llc" roll up together. Group order: named entities first (collation
 * order, stable), then "Unassigned" last.
 */

/** Display label for properties with no legal entity set. */
export const UNASSIGNED_ENTITY_LABEL = "Unassigned";

/** The subset of per-property fields the rollup sums. Mirrors the bigint
 *  money columns on a Financials row; the page passes its own richer rows in
 *  (structurally compatible) and reads back the same shape per group. */
export interface PortfolioRowInput {
  /** Legal entity name; null/blank → the Unassigned bucket. */
  legalEntityName: string | null;
  expectedMonthlyCents: Cents;
  collectedMonthCents: Cents;
  mortgageMonthlyCents: Cents;
  insuranceMonthlyCents: Cents;
  taxesMonthlyCents: Cents;
  expensesMonthCents: Cents;
  netMonthCents: Cents;
}

/** Per-entity subtotals (same money fields, summed over the group's rows). */
export interface PortfolioSubtotal {
  expectedMonthlyCents: Cents;
  collectedMonthCents: Cents;
  mortgageMonthlyCents: Cents;
  insuranceMonthlyCents: Cents;
  taxesMonthlyCents: Cents;
  expensesMonthCents: Cents;
  netMonthCents: Cents;
}

export interface PortfolioGroup<R extends PortfolioRowInput> {
  /** Display label (first-seen spelling, or "Unassigned"). */
  entity: string;
  /** True for the catch-all bucket of entity-less properties. */
  unassigned: boolean;
  rows: R[];
  subtotal: PortfolioSubtotal;
}

const MONEY_KEYS = [
  "expectedMonthlyCents",
  "collectedMonthCents",
  "mortgageMonthlyCents",
  "insuranceMonthlyCents",
  "taxesMonthlyCents",
  "expensesMonthCents",
  "netMonthCents",
] as const;

function zeroSubtotal(): PortfolioSubtotal {
  return {
    expectedMonthlyCents: 0n,
    collectedMonthCents: 0n,
    mortgageMonthlyCents: 0n,
    insuranceMonthlyCents: 0n,
    taxesMonthlyCents: 0n,
    expensesMonthCents: 0n,
    netMonthCents: 0n,
  };
}

function subtotalOf(rows: readonly PortfolioRowInput[]): PortfolioSubtotal {
  const out = zeroSubtotal();
  for (const k of MONEY_KEYS) {
    out[k] = sumCents(rows.map((r) => r[k]));
  }
  return out;
}

/**
 * Bucket rows by legal entity and subtotal each group. Generic over the row
 * type so the Financials page can pass its full {@link PropertyFinancialRow}s
 * and read the same objects back (with their property name, currency, etc.).
 */
export function groupByEntity<R extends PortfolioRowInput>(
  rows: readonly R[],
): {
  groups: PortfolioGroup<R>[];
  grandTotal: PortfolioSubtotal;
} {
  // Preserve first-seen insertion order for named entities; the Unassigned
  // bucket is handled separately so it always sorts last.
  const named = new Map<string, { label: string; rows: R[] }>();
  const unassignedRows: R[] = [];

  for (const row of rows) {
    const trimmed = row.legalEntityName?.trim() ?? "";
    if (trimmed === "") {
      unassignedRows.push(row);
      continue;
    }
    const key = trimmed.toLowerCase();
    let bucket = named.get(key);
    if (!bucket) {
      bucket = { label: trimmed, rows: [] };
      named.set(key, bucket);
    }
    bucket.rows.push(row);
  }

  const collator = new Intl.Collator(undefined, { sensitivity: "base" });
  const groups: PortfolioGroup<R>[] = [...named.values()]
    .sort((a, b) => collator.compare(a.label, b.label))
    .map((b) => ({
      entity: b.label,
      unassigned: false,
      rows: b.rows,
      subtotal: subtotalOf(b.rows),
    }));

  if (unassignedRows.length > 0) {
    groups.push({
      entity: UNASSIGNED_ENTITY_LABEL,
      unassigned: true,
      rows: unassignedRows,
      subtotal: subtotalOf(unassignedRows),
    });
  }

  return { groups, grandTotal: subtotalOf(rows) };
}
