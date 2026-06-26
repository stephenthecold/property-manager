import Link from "next/link";

/**
 * Consistent "back to parent" link for detail-page headers — one style across
 * the app (muted text + a leading arrow). Render it as the first element in a
 * detail page's header so every page has uniform back navigation.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="text-sm text-muted-foreground hover:text-foreground hover:underline"
    >
      ← {label}
    </Link>
  );
}
