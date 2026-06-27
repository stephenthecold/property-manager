"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
 * Grouped top-tab settings nav: each logical group (Organization, Leasing,
 * Communications, Access, Platform) gets a small caps label with its sections
 * beneath, wrapping across the top so the content below can use the full width.
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-x-6 gap-y-3 border-b pb-4">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1.5">
          <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          <div className="flex flex-wrap gap-1">
            {group.links.map((l) => {
              const active =
                pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
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
    </nav>
  );
}
