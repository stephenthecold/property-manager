"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { NavEntry } from "@/components/app/nav-links";

interface SecondaryLink {
  href: string;
  label: string;
}

/**
 * The mobile/tablet navigation: a hamburger button (hidden at `lg`+, where the
 * horizontal NavLinks bar takes over) that opens a left drawer listing every
 * nav link as a 44px-tall touch target. Groups become labeled sections so the
 * full tree is reachable without dropdowns. Each link is a `SheetClose`, so a
 * tap dismisses the drawer and navigates — no controlled state to manage.
 */
export function MobileNav({
  items,
  secondary,
  userLabel,
}: {
  items: NavEntry[];
  secondary: SecondaryLink[];
  userLabel: string;
}) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const itemClass = (href: string) =>
    cn(
      "flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors",
      isActive(href)
        ? "bg-foreground text-background"
        : "text-foreground hover:bg-muted",
    );

  return (
    <Sheet>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            className="size-11 lg:hidden"
          />
        }
      >
        <MenuIcon className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-0 overflow-y-auto">
        <SheetTitle>Menu</SheetTitle>
        <SheetDescription className="sr-only">Primary navigation</SheetDescription>

        <nav className="mt-4 flex flex-col gap-0.5">
          {items.map((entry) =>
            "items" in entry ? (
              <div key={entry.label} className="mt-3 first:mt-0">
                <p className="px-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {entry.label}
                </p>
                {entry.items.map((i) => (
                  <SheetClose
                    key={i.href}
                    nativeButton={false}
                    render={<Link href={i.href} className={itemClass(i.href)} />}
                  >
                    {i.label}
                  </SheetClose>
                ))}
              </div>
            ) : (
              <SheetClose
                key={entry.href}
                nativeButton={false}
                render={<Link href={entry.href} className={itemClass(entry.href)} />}
              >
                {entry.label}
              </SheetClose>
            ),
          )}
        </nav>

        {secondary.length > 0 && (
          <div className="mt-4 flex flex-col gap-0.5 border-t pt-4">
            {secondary.map((s) => (
              <SheetClose
                key={s.href}
                nativeButton={false}
                render={<Link href={s.href} className={itemClass(s.href)} />}
              >
                {s.label}
              </SheetClose>
            ))}
          </div>
        )}

        <p className="mt-4 border-t px-3 pt-4 text-xs break-words text-muted-foreground">
          {userLabel}
        </p>
      </SheetContent>
    </Sheet>
  );
}
