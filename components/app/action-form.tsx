"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { FormState } from "@/lib/forms";

/**
 * A plain (non-dialog) form bound to a server action that RETURNS a
 * {@link FormState}. A returned `error` renders inline — the input stays put —
 * instead of throwing and tripping the opaque production error page. Actions
 * that revalidate-and-return `{ ok }` show `successMessage` + refresh; actions
 * that `redirect()` on success simply navigate away.
 *
 * Use this for full-page create/edit forms; FormDialog covers the pop-out case.
 */
export function ActionForm({
  action,
  submitLabel = "Save",
  submitSize = "sm",
  successMessage,
  className,
  children,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  submitLabel?: string;
  submitSize?: "default" | "sm" | "xs" | "lg";
  successMessage?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState<FormState, FormData>(
    action,
    {},
  );

  React.useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={formAction} className={className}>
      {children}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && successMessage && (
        <Alert>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size={submitSize} disabled={pending}>
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
