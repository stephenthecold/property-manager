"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Consistent "back" control for detail-page headers — one style across the app
 * (muted text + a leading arrow). Render it as the first element in a detail
 * page's header so every page has uniform back navigation.
 *
 * A plain left-click returns you to the page you actually came from
 * (`router.back()`), so a cross-section jump (e.g. an inspection → a unit) comes
 * back where you were — not just to the section list. On a direct load with no
 * in-app history it falls back to `href` (the section home). It stays a real
 * `<a href>` so open-in-new-tab / middle-click and SSR keep working, and the
 * `label` gives the section context.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return (
    <Link
      href={href}
      onClick={(e) => {
        // Let modified clicks (open in new tab/window) use the real href.
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        if (typeof window !== "undefined" && window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
      className="text-sm text-muted-foreground hover:text-foreground hover:underline"
    >
      ← {label}
    </Link>
  );
}
