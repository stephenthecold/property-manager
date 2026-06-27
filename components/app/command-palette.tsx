"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SearchKind, SearchResult } from "@/lib/services/search";

const emptySubscribe = () => () => {};

const KIND_LABEL: Record<SearchKind, string> = {
  tenant: "Tenants",
  property: "Properties",
  unit: "Units",
  lease: "Leases",
  maintenance: "Maintenance",
};

// Stable display order for the grouped results.
const KIND_ORDER: SearchKind[] = [
  "tenant",
  "property",
  "unit",
  "lease",
  "maintenance",
];

const DEBOUNCE_MS = 200;

/**
 * ⌘K / Ctrl+K global command palette. Opens a modal search over records
 * (tenants, properties, units, leases, maintenance) and navigates to the
 * selected result. Read-only — it only reads `/api/search`, which is capability
 * gated server-side.
 *
 * Hydration: the keyboard hint reads the platform (⌘ vs Ctrl) which the server
 * can't know, so it stays a constant "⌘K" until mounted to avoid an attribute
 * mismatch (same pattern as theme-toggle).
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [active, setActive] = React.useState(0);

  // True only after hydration — gates the platform-specific shortcut label.
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const isMac =
    mounted &&
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad/.test(navigator.platform);

  // Reset transient state whenever the dialog opens or closes. Done in the
  // open-change handler (not an effect) to avoid cascading-render setState.
  const onOpenChange = React.useCallback((next: boolean) => {
    setOpen(next);
    setQuery("");
    setResults([]);
    setActive(0);
    setLoading(false);
  }, []);

  // Global toggle on (Cmd|Ctrl)+K. Routes through onOpenChange so each open/close
  // starts from a clean slate; re-subscribes on toggle to read the latest `open`.
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // Debounced fetch. An AbortController + a per-effect "stale" flag keep a slow
  // earlier response from overwriting a newer one. All setState here runs inside
  // the async timeout callback (never synchronously in the effect body).
  React.useEffect(() => {
    const term = query.trim();
    const controller = new AbortController();
    let stale = false;
    const handle = setTimeout(async () => {
      if (term.length < 1) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`search failed: ${res.status}`);
        const data = (await res.json()) as { results?: SearchResult[] };
        if (!stale) {
          setResults(Array.isArray(data.results) ? data.results : []);
          setActive(0);
        }
      } catch {
        // Aborts and transient failures fall back to an empty list. Reset the
        // selection too so a later Enter never indexes a stale position.
        if (!stale) {
          setResults([]);
          setActive(0);
        }
      } finally {
        if (!stale) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      controller.abort();
      clearTimeout(handle);
    };
  }, [query]);

  const go = React.useCallback(
    (result: SearchResult | undefined) => {
      if (!result) return;
      onOpenChange(false);
      router.push(result.href);
    },
    [onOpenChange, router],
  );

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) =>
        results.length ? (i - 1 + results.length) % results.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  }

  // Group results by kind for rendering, while keeping a flat index for the
  // active highlight / arrow navigation.
  const grouped = KIND_ORDER.map((kind) => ({
    kind,
    items: results
      .map((r, index) => ({ r, index }))
      .filter((x) => x.r.kind === kind),
  })).filter((g) => g.items.length > 0);

  const hasQuery = query.trim().length >= 1;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => onOpenChange(true)}
        aria-label="Open search"
      >
        <SearchIcon className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border bg-muted px-1 text-[0.7rem] font-medium sm:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-24 max-h-[70vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">
            Search tenants, properties, units, leases, and maintenance jobs.
          </DialogDescription>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search tenants, properties, units, leases…"
              className="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
              aria-label="Search"
            />
          </div>

          <div className="max-h-[55vh] overflow-y-auto py-2">
            {!hasQuery ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Type to search across the app.
              </p>
            ) : loading && results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Searching…
              </p>
            ) : results.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No results for “{query.trim()}”.
              </p>
            ) : (
              grouped.map((group) => (
                <div key={group.kind} className="px-1.5 pb-1.5">
                  <p className="px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                    {KIND_LABEL[group.kind]}
                  </p>
                  <ul>
                    {group.items.map(({ r, index }) => (
                      <li key={`${r.kind}:${r.id}`}>
                        <button
                          type="button"
                          // Mouse hover/click drives the same selection as the keyboard.
                          onMouseEnter={() => setActive(index)}
                          onClick={() => go(r)}
                          className={cn(
                            "flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left transition-colors duration-150 active:translate-y-px",
                            index === active
                              ? "bg-muted text-foreground"
                              : "hover:bg-muted/60",
                          )}
                        >
                          <span className="text-sm">{r.label}</span>
                          {r.sublabel && (
                            <span className="text-xs text-muted-foreground">
                              {r.sublabel}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
