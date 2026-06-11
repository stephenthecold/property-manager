"use client";

import { Button } from "@/components/ui/button";

/**
 * Submit button for destructive server-action forms: asks for confirmation
 * before letting the form submit.
 */
export function ConfirmSubmitButton({
  confirmMessage,
  children,
  variant = "destructive",
  size = "sm",
}: {
  confirmMessage: string;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      onClick={(e) => {
        if (!window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}
