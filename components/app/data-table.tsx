"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Client-side sortable + paginated table over rows that were fully rendered
 * on the server. Pages keep their data fetching and per-cell JSX (links,
 * badges, server-action forms); this component only reorders and slices.
 *
 * Money sort values must cross the RSC boundary as strings of integer cents
 * (`String(cents)`), never floats — integer strings are compared exactly.
 */

export type SortValue = string | number | null;

export type DataTableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Sort numerically; values may be numbers or integer strings (bigint cents). */
  numeric?: boolean;
  /** Default true. */
  sortable?: boolean;
  /** Applied to both the header and body cells (e.g. responsive hiding). */
  className?: string;
};

export type DataTableRow = {
  key: string;
  /** One rendered node per column. */
  cells: React.ReactNode[];
  /** One primitive per column for sorting; null always sorts last. */
  sortValues: SortValue[];
};

const PAGE_SIZE_OPTIONS = [10, 20, 50];

/** Exact comparison for integer strings of any length (e.g. bigint cents). */
function compareIntStrings(a: string, b: string): number {
  const negA = a.startsWith("-");
  const negB = b.startsWith("-");
  if (negA !== negB) return negA ? -1 : 1;
  const pa = negA ? a.slice(1) : a;
  const pb = negB ? b.slice(1) : b;
  const c =
    pa.length !== pb.length
      ? pa.length - pb.length
      : pa < pb
        ? -1
        : pa > pb
          ? 1
          : 0;
  return negA ? -c : c;
}

function compareNumeric(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = String(a);
  const sb = String(b);
  if (/^-?\d+$/.test(sa) && /^-?\d+$/.test(sb)) return compareIntStrings(sa, sb);
  return Number(sa) - Number(sb);
}

export function DataTable({
  columns,
  rows,
  defaultSort,
  defaultPageSize = 10,
  emptyMessage = "No results.",
  className,
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  defaultPageSize?: number;
  emptyMessage?: string;
  className?: string;
}) {
  const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" } | null>(
    defaultSort ?? null,
  );
  const [pageSize, setPageSize] = React.useState(defaultPageSize);
  const [page, setPage] = React.useState(0);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const idx = columns.findIndex((c) => c.key === sort.key);
    if (idx < 0) return rows;
    const numeric = !!columns[idx].numeric;
    const dir = sort.dir === "asc" ? 1 : -1;
    const collator = new Intl.Collator(undefined, {
      numeric: true,
      sensitivity: "base",
    });
    return [...rows].sort((ra, rb) => {
      const a = ra.sortValues[idx];
      const b = rb.sortValues[idx];
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      const c = numeric ? compareNumeric(a, b) : collator.compare(String(a), String(b));
      return c * dir;
    });
  }, [rows, columns, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  const visible = sorted.slice(start, start + pageSize);
  const showPagination = rows.length > PAGE_SIZE_OPTIONS[0];

  function toggleSort(key: string) {
    setPage(0);
    setSort((s) =>
      s?.key === key
        ? s.dir === "asc"
          ? { key, dir: "desc" }
          : null
        : { key, dir: "asc" },
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60">
              {columns.map((col) => {
                const sortable = col.sortable !== false;
                const active = sort?.key === col.key;
                return (
                  <TableHead
                    key={col.key}
                    aria-sort={
                      active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined
                    }
                    className={cn(col.align === "right" && "text-right", col.className)}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "inline-flex h-8 items-center gap-1 rounded-md font-medium transition-colors hover:text-primary",
                          col.align === "right" ? "justify-end" : "-ml-1 px-1",
                          active && "text-primary",
                        )}
                      >
                        {col.label}
                        {active ? (
                          sort.dir === "asc" ? (
                            <ArrowUpIcon className="size-3.5" />
                          ) : (
                            <ArrowDownIcon className="size-3.5" />
                          )
                        ) : (
                          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground/60" />
                        )}
                      </button>
                    ) : (
                      col.label
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody className="[&>tr:nth-child(even)]:bg-muted/30">
            {visible.map((row) => (
              <TableRow key={row.key}>
                {row.cells.map((cell, i) => (
                  <TableCell
                    key={columns[i]?.key ?? i}
                    className={cn(
                      columns[i]?.align === "right" && "text-right",
                      columns[i]?.className,
                    )}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="py-6 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {showPagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            Showing {sorted.length === 0 ? 0 : start + 1}–
            {Math.min(start + pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Rows per page
              <select
                value={pageSize}
                onChange={(e) => {
                  setPage(0);
                  setPageSize(Number(e.target.value));
                }}
                className="h-8 rounded-md border bg-transparent px-2 text-sm text-foreground"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="tabular-nums">
              Page {current + 1} of {pageCount}
            </span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Previous page"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Next page"
                disabled={current >= pageCount - 1}
                onClick={() => setPage(current + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
