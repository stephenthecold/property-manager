"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * A quick fade + rise on the main content each navigation. Keyed by pathname so
 * the enter animation replays per route. GPU-friendly (opacity + a ~4px
 * transform via tw-animate-css `translate3d`), and the global
 * prefers-reduced-motion reset neutralizes it for users who opt out.
 *
 * The children are server components passed through as a prop — this client
 * wrapper does NOT make them client-rendered.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div
      key={pathname}
      className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      {children}
    </div>
  );
}
