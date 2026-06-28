import type { ReactNode } from "react";
import { BackLink } from "@/components/app/back-link";
import { cn } from "@/lib/utils";

/**
 * The single page header for staff pages: an optional history-aware back-link,
 * an h1 title, optional description, and an optional right-aligned actions slot.
 * Replaces the ~34 hand-rolled `<div className="flex … justify-between"><h1
 * className="text-2xl font-semibold">…</h1><Button/></div>` blocks so every page
 * lines up — same title size, spacing, action alignment, and wrap behaviour.
 */
export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot for buttons / dialogs; wraps under the title on narrow widths. */
  actions?: ReactNode;
  /** Renders the shared history-aware BackLink above the title. */
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {back ? <BackLink href={back.href} label={back.label} /> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
