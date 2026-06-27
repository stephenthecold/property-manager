import { cn } from "@/lib/utils";

/**
 * A pulsing placeholder block. Compose into route-shaped loading states (see
 * components/app/skeletons.tsx). The pulse is `animate-pulse`; the global
 * prefers-reduced-motion reset (app/globals.css) neutralizes it to a static
 * tint for users who opt out, so it stays a calm placeholder either way.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
