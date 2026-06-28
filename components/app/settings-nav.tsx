"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SettingsNavLink {
  href: string;
  label: string;
}

export interface SettingsNavGroup {
  label: string;
  links: SettingsNavLink[];
}

/**
 * Settings section navigation.
 *
 * - **md+**: a sticky vertical sidebar — each logical group (Organization,
 *   Leasing, Communications, Access, Platform) is a small-caps label with its
 *   sections stacked beneath.
 * - **mobile**: a compact disclosure that shows the current section and expands
 *   the same grouped list on tap, so the page content stays reachable at the top
 *   instead of sitting below a tall nav stack.
 *
 * The active section is marked with `aria-current="page"` in both layouts.
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (l: SettingsNavLink) =>
    pathname === l.href || pathname.startsWith(`${l.href}/`);
  const current = groups.flatMap((g) => g.links).find(isActive);

  const groupedLinks = (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.links.map((l) => {
              const active = isActive(l);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <nav aria-label="Settings sections">
      {/* Mobile: collapsed disclosure showing the current section. */}
      <div className="md:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2.5 text-sm font-medium"
        >
          <span className="truncate">
            <span className="text-muted-foreground">Settings · </span>
            {current?.label ?? "Choose a section"}
          </span>
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
        {open && <div className="mt-2 rounded-md border p-2">{groupedLinks}</div>}
      </div>

      {/* md+: sticky vertical sidebar. */}
      <div className="hidden md:sticky md:top-6 md:block">{groupedLinks}</div>
    </nav>
  );
}
