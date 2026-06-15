"use client";

import { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  GripVerticalIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DashboardLayout } from "@/lib/dashboard/layout";

export interface DashboardSection {
  id: string;
  title: React.ReactNode;
  content: React.ReactNode;
}

/**
 * Client shell that lets a user reorder (drag handle or ▲/▼) and collapse the
 * dashboard sections, persisting per-user. The server passes sections already
 * in the saved order (no flash); this component owns the live state and
 * best-effort-persists every change to the /api/dashboard/layout route.
 */
export function DashboardSections({
  sections,
  initialOrder,
  initialCollapsed,
}: {
  sections: DashboardSection[];
  initialOrder: string[];
  initialCollapsed: Record<string, boolean>;
}) {
  const byId = useMemo(
    () => new Map(sections.map((s) => [s.id, s])),
    [sections],
  );
  // Only ids we actually have a section for, in the server-provided order.
  const [order, setOrder] = useState<string[]>(
    initialOrder.filter((id) => byId.has(id)),
  );
  const [collapsed, setCollapsed] =
    useState<Record<string, boolean>>(initialCollapsed);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function persist(next: DashboardLayout) {
    // Fire-and-forget to an API route — NOT a Server Action (which would
    // invalidate the router cache and refetch the whole dashboard on every
    // toggle). Best-effort: a failed save just isn't remembered next load.
    void fetch("/api/dashboard/layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
      keepalive: true,
    }).catch(() => {});
  }

  function reorder(from: string, to: string) {
    if (from === to) return;
    setOrder((prev) => {
      const next = prev.slice();
      const fi = next.indexOf(from);
      const ti = next.indexOf(to);
      if (fi < 0 || ti < 0) return prev;
      next.splice(fi, 1);
      next.splice(ti, 0, from);
      persist({ order: next, collapsed });
      return next;
    });
  }

  function nudge(id: string, dir: -1 | 1) {
    setOrder((prev) => {
      const i = prev.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      persist({ order: next, collapsed });
      return next;
    });
  }

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      persist({ order, collapsed: next });
      return next;
    });
  }

  return (
    <div className="space-y-6">
      {order.map((id, idx) => {
        const section = byId.get(id);
        if (!section) return null;
        const isCollapsed = !!collapsed[id];
        return (
          <Card
            key={id}
            onDragOver={(e) => {
              if (dragId && dragId !== id) {
                e.preventDefault();
                setOverId(id);
              }
            }}
            onDrop={(e) => {
              if (dragId) {
                e.preventDefault();
                reorder(dragId, id);
              }
              setDragId(null);
              setOverId(null);
            }}
            className={cn(
              "transition-shadow",
              dragId === id && "opacity-50",
              overId === id && dragId && dragId !== id && "ring-2 ring-primary",
            )}
          >
            <div className="flex items-center justify-between gap-2 px-6 py-4">
              <button
                type="button"
                onClick={() => toggleCollapse(id)}
                aria-expanded={!isCollapsed}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-base font-semibold"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    isCollapsed && "-rotate-90",
                  )}
                />
                <span className="min-w-0 truncate">{section.title}</span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                <button
                  type="button"
                  onClick={() => nudge(id, -1)}
                  disabled={idx === 0}
                  aria-label="Move section up"
                  className="rounded p-1 hover:bg-muted disabled:opacity-30"
                >
                  <ChevronUpIcon className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => nudge(id, 1)}
                  disabled={idx === order.length - 1}
                  aria-label="Move section down"
                  className="rounded p-1 hover:bg-muted disabled:opacity-30"
                >
                  <ChevronDownIcon className="size-4" />
                </button>
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragId(id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  aria-label="Drag to reorder"
                  role="button"
                  tabIndex={-1}
                  className="cursor-grab rounded p-1 hover:bg-muted active:cursor-grabbing"
                >
                  <GripVerticalIcon className="size-4" />
                </span>
              </div>
            </div>
            {!isCollapsed && <CardContent className="pt-0">{section.content}</CardContent>}
          </Card>
        );
      })}
    </div>
  );
}
