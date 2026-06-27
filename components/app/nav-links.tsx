"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export interface NavItem {
  href: string;
  label: string;
}

/** A labeled dropdown grouping several links. */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

function isGroup(e: NavEntry): e is NavGroup {
  return Array.isArray((e as NavGroup).items);
}

const linkClass = (active: boolean) =>
  cn(
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
    active
      ? "bg-foreground text-background"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );

export function NavLinks({
  items,
  className,
}: {
  items: NavEntry[];
  className?: string;
}) {
  const pathname = usePathname();
  // A link is active on its own path or any sub-path (e.g. /leases/123).
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav className={cn("flex flex-wrap items-center gap-1", className)}>
      {items.map((entry) => {
        if (!isGroup(entry)) {
          return (
            <Link
              key={entry.href}
              href={entry.href}
              className={linkClass(isActive(entry.href))}
            >
              {entry.label}
            </Link>
          );
        }
        // The group trigger lights up when you're on one of its pages, so the
        // active section stays visible even though the link is tucked away.
        const groupActive = entry.items.some((i) => isActive(i.href));
        return (
          <DropdownMenu key={entry.label}>
            <DropdownMenuTrigger
              className={cn(linkClass(groupActive), "inline-flex items-center gap-1")}
            >
              {entry.label}
              <ChevronDownIcon className="size-3.5 opacity-70" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-48">
              {entry.items.map((i) => (
                <DropdownMenuItem
                  key={i.href}
                  className={cn(isActive(i.href) && "font-semibold text-foreground")}
                  render={<Link href={i.href} />}
                >
                  {i.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}
