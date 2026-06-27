import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A friendly empty state: optional icon, a title, an optional one-line
 * description, and an optional action (e.g. a "Add …" button). Use it instead
 * of a bare "No results." string when a list is empty — including via the
 * `DataTable` `emptyState` prop, which drops this into the table body.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-1 text-muted-foreground/60 [&>svg]:size-8">{icon}</div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
