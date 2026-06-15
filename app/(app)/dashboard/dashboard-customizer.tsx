"use client";

import { useMemo, useState } from "react";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardLayout } from "@/lib/dashboard/layout";

export interface DashboardBubble {
  id: string;
  label: string;
  node: React.ReactNode;
}
export interface DashboardSection {
  id: string;
  label: string;
  title: React.ReactNode;
  content: React.ReactNode;
}

/**
 * Fully customizable dashboard: the user can show/hide and reorder each top stat
 * bubble AND each section below, with an "Edit dashboard" mode revealing the
 * controls and an "Add element" tray for restoring hidden items. State is owned
 * here and best-effort-persisted to /api/dashboard/layout (a fetch, never a
 * Server Action — that would refetch the whole dashboard).
 */
export function DashboardCustomizer({
  bubbles,
  sections,
  initial,
}: {
  bubbles: DashboardBubble[];
  sections: DashboardSection[];
  initial: DashboardLayout;
}) {
  const bubbleById = useMemo(() => new Map(bubbles.map((b) => [b.id, b])), [bubbles]);
  const sectionById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const availBubbles = useMemo(() => new Set(bubbles.map((b) => b.id)), [bubbles]);
  const availSections = useMemo(() => new Set(sections.map((s) => s.id)), [sections]);

  const [bubbleOrder, setBubbleOrder] = useState(initial.bubbleOrder);
  const [sectionOrder, setSectionOrder] = useState(initial.sectionOrder);
  const [collapsed, setCollapsed] = useState(initial.collapsed);
  const [hidden, setHidden] = useState(initial.hidden);
  const [editing, setEditing] = useState(false);

  function persist(next: Partial<DashboardLayout>) {
    const body: DashboardLayout = {
      bubbleOrder,
      sectionOrder,
      collapsed,
      hidden,
      ...next,
    };
    void fetch("/api/dashboard/layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  }

  // Swap two adjacent VISIBLE items, keeping hidden items in their slots.
  function move(
    order: string[],
    id: string,
    dir: -1 | 1,
    avail: Set<string>,
  ): string[] | null {
    const visible = order.filter((x) => avail.has(x) && !hidden[x]);
    const i = visible.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= visible.length) return null;
    [visible[i], visible[j]] = [visible[j], visible[i]];
    let vi = 0;
    return order.map((x) => (avail.has(x) && !hidden[x] ? visible[vi++] : x));
  }

  function moveBubble(id: string, dir: -1 | 1) {
    const next = move(bubbleOrder, id, dir, availBubbles);
    if (next) {
      setBubbleOrder(next);
      persist({ bubbleOrder: next });
    }
  }
  function moveSection(id: string, dir: -1 | 1) {
    const next = move(sectionOrder, id, dir, availSections);
    if (next) {
      setSectionOrder(next);
      persist({ sectionOrder: next });
    }
  }
  function setHide(id: string, value: boolean) {
    setHidden((prev) => {
      const next = { ...prev };
      if (value) next[id] = true;
      else delete next[id];
      persist({ hidden: next });
      return next;
    });
  }
  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      persist({ collapsed: next });
      return next;
    });
  }

  const visibleBubbleIds = bubbleOrder.filter((id) => availBubbles.has(id) && !hidden[id]);
  const visibleSectionIds = sectionOrder.filter((id) => availSections.has(id) && !hidden[id]);
  const hiddenItems = [
    ...bubbleOrder.filter((id) => availBubbles.has(id) && hidden[id]).map((id) => bubbleById.get(id)!),
    ...sectionOrder.filter((id) => availSections.has(id) && hidden[id]).map((id) => sectionById.get(id)!),
  ];

  const ctrlBtn =
    "rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30";

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          type="button"
          variant={editing ? "default" : "outline"}
          size="sm"
          onClick={() => setEditing((e) => !e)}
        >
          <PencilIcon className="mr-1 size-3.5" />
          {editing ? "Done" : "Edit dashboard"}
        </Button>
      </div>

      {/* Stat bubbles */}
      {visibleBubbleIds.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
          {visibleBubbleIds.map((id, idx) => (
            <div key={id} className="relative">
              {bubbleById.get(id)!.node}
              {editing && (
                <div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-md border bg-card/90 p-0.5 shadow-sm backdrop-blur">
                  <button
                    type="button"
                    onClick={() => moveBubble(id, -1)}
                    disabled={idx === 0}
                    aria-label="Move bubble earlier"
                    className={ctrlBtn}
                  >
                    <ChevronLeftIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBubble(id, 1)}
                    disabled={idx === visibleBubbleIds.length - 1}
                    aria-label="Move bubble later"
                    className={ctrlBtn}
                  >
                    <ChevronRightIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHide(id, true)}
                    aria-label="Hide bubble"
                    className={cn(ctrlBtn, "hover:text-red-600")}
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sections */}
      {visibleSectionIds.map((id, idx) => {
        const section = sectionById.get(id)!;
        const isCollapsed = !!collapsed[id];
        return (
          <Card key={id}>
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
              {editing && (
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveSection(id, -1)}
                    disabled={idx === 0}
                    aria-label="Move section up"
                    className={ctrlBtn}
                  >
                    <ChevronUpIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveSection(id, 1)}
                    disabled={idx === visibleSectionIds.length - 1}
                    aria-label="Move section down"
                    className={ctrlBtn}
                  >
                    <ChevronDownIcon className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setHide(id, true)}
                    aria-label="Hide section"
                    className={cn(ctrlBtn, "hover:text-red-600")}
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              )}
            </div>
            {!isCollapsed && <CardContent className="pt-0">{section.content}</CardContent>}
          </Card>
        );
      })}

      {/* Add-element tray (edit mode) */}
      {editing && (
        <Card className="border-dashed">
          <CardContent className="space-y-2 py-4">
            <div className="text-sm font-medium">Hidden elements</div>
            {hiddenItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing hidden. Use the × on any bubble or section to tuck it away
                here.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {hiddenItems.map((el) => (
                  <button
                    key={el.id}
                    type="button"
                    onClick={() => setHide(el.id, false)}
                    className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm hover:bg-muted"
                  >
                    <PlusIcon className="size-3.5" />
                    {el.label}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
