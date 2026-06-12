"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

/**
 * Light ↔ dark switch (Slate & Sky ↔ Navy Night). Persisted by next-themes.
 * The label stays constant and the icon swaps only after hydration — the
 * server can't know the stored theme, and React won't patch mismatched
 * attributes.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // True only on the client after hydration (server snapshot is false).
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const dark = mounted && resolvedTheme === "dark";
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {mounted ? (
        dark ? (
          <SunIcon className="size-4" />
        ) : (
          <MoonIcon className="size-4" />
        )
      ) : (
        <MoonIcon className="size-4 opacity-0" />
      )}
    </Button>
  );
}
