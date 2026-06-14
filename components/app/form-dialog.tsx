"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import type { FormState } from "@/lib/forms";

/**
 * What a form action returns so the dialog can react: a returned `error` is
 * shown inline (the form stays open, input preserved); `ok` closes + refreshes.
 * Returning the error as DATA — rather than throwing — is what keeps a bad
 * entry from surfacing as the opaque production error page.
 */
export type FormDialogState = FormState;

type CommonProps = {
  trigger: string;
  triggerVariant?: "default" | "outline" | "ghost" | "secondary";
  triggerSize?: "default" | "sm" | "xs" | "lg";
  title: string;
  description?: string;
  wide?: boolean;
  children: React.ReactNode;
};

/**
 * Button that pops a dialog around a form.
 *
 * Preferred mode — pass an `action` (a server action with the
 * `(prevState, FormData) => FormDialogState` shape). The dialog owns the
 * `<form>` and submit button; you pass only the fields. A returned `error`
 * renders inline and the dialog stays open; `{ ok: true }` closes it and
 * refreshes. This is how a validation message reaches the user instead of a
 * black error page.
 *
 * Static mode — pass `staticContent` (no `action`) when the dialog holds more
 * than one form (or forms that self-manage via {@link ActionForm}). Children
 * render as-is and the dialog stays open until dismissed; each inner form owns
 * its own submit/error/refresh.
 *
 * Legacy mode — omit both and pass your own `<form>` as children. The dialog
 * closes on submit and refreshes shortly after, with no inline error surface.
 * Kept only for forms that don't validate (e.g. plain toggles).
 */
export function FormDialog(
  props:
    | (CommonProps & {
        action: (
          prev: FormDialogState,
          fd: FormData,
        ) => Promise<FormDialogState>;
        submitLabel?: string;
        staticContent?: undefined;
      })
    | (CommonProps & {
        action?: undefined;
        submitLabel?: undefined;
        staticContent?: boolean;
      }),
) {
  const {
    trigger,
    triggerVariant = "outline",
    triggerSize = "sm",
    title,
    description,
    wide = false,
    children,
  } = props;
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  // Legacy: the inner form passed native validation, so close + refresh (the
  // action's own revalidation may be dropped once the form unmounts).
  function handleLegacySubmit() {
    setOpen(false);
    setTimeout(() => router.refresh(), 400);
    setTimeout(() => router.refresh(), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={triggerVariant} size={triggerSize} />}
      >
        {trigger}
      </DialogTrigger>
      <DialogContent
        className={cn(
          "max-h-[85vh] overflow-y-auto",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {props.action ? (
          <ActionForm
            // Re-mount on each open so a previous error/success never lingers.
            key={open ? "open" : "closed"}
            action={props.action}
            submitLabel={props.submitLabel ?? "Save"}
            onSuccess={() => setOpen(false)}
          >
            {children}
          </ActionForm>
        ) : props.staticContent ? (
          <div className="space-y-4">{children}</div>
        ) : (
          <div onSubmit={handleLegacySubmit}>{children}</div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActionForm({
  action,
  submitLabel,
  onSuccess,
  children,
}: {
  action: (prev: FormDialogState, fd: FormData) => Promise<FormDialogState>;
  submitLabel: string;
  onSuccess: () => void;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, formAction, pending] = React.useActionState<
    FormDialogState,
    FormData
  >(action, {});

  React.useEffect(() => {
    if (state.ok) {
      router.refresh();
      onSuccess();
    }
    // onSuccess just closes the dialog; re-running it on a re-render is a no-op.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok, router]);

  return (
    <form action={formAction} className="space-y-4">
      {children}
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
