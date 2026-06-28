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
 * Vertical settings sidebar: each logical group (Organization, Leasing,
 * Communications, Access, Platform) is a small caps label with its sections
 * stacked beneath. Sits in the left rail on md+ (sticky) and stacks above the
 * content on mobile. The active section is marked with aria-current for AT.
 */
export function SettingsNav({ groups }: { groups: SettingsNavGroup[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Settings sections"
      className="flex flex-col gap-5 md:sticky md:top-6"
    >
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <div className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.links.map((l) => {
              const active =
                pathname === l.href || pathname.startsWith(`${l.href}/`);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={active ? "page" : undefined}
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
