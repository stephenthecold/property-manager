"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  saveLeaseAgreementTextAction,
  uploadLeaseTemplateAction,
  type LeaseSettingsState,
} from "./actions";

/** Clause-text editor with placeholder docs and a reset-to-default affordance. */
export function LeaseAgreementTextForm({
  initialText,
  defaultText,
  hasOverride,
  placeholders,
}: {
  /** The currently effective text (override when set, otherwise the default). */
  initialText: string;
  defaultText: string;
  hasOverride: boolean;
  placeholders: { key: string; description: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [state, formAction, pending] = useActionState<LeaseSettingsState, FormData>(
    async (prev, fd) => {
      const next = await saveLeaseAgreementTextAction(prev, fd);
      if (next.ok) router.refresh();
      return next;
    },
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="text">Agreement clause text</Label>
        <textarea
          id="text"
          name="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={18}
          className="w-full rounded-md border p-3 font-mono text-xs leading-5"
        />
        <p className="text-xs text-muted-foreground">
          {hasOverride
            ? "Using custom text."
            : "Using the built-in default text."}{" "}
          Saving an empty editor (or text identical to the default) reverts to
          the built-in default.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save agreement text"}
        </Button>
        <Button type="button" variant="outline" onClick={() => setText(defaultText)}>
          Reset to default
        </Button>
      </div>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Available placeholders
        </summary>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          {placeholders.map((p) => (
            <div key={p.key} className="flex gap-2 text-xs">
              <dt className="shrink-0 font-mono">{`{{${p.key}}}`}</dt>
              <dd className="text-muted-foreground">{p.description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </form>
  );
}

/** .docx template upload (latest upload becomes the active template). */
export function LeaseTemplateUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<LeaseSettingsState, FormData>(
    async (prev, fd) => {
      const next = await uploadLeaseTemplateAction(prev, fd);
      if (next.ok) {
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
      return next;
    },
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="template">.docx template</Label>
        <input
          ref={fileRef}
          id="template"
          name="template"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="text-sm"
          required
        />
        <p className="text-xs text-muted-foreground">
          Word (.docx) only, max 2 MB. Use the same {"{{placeholders}}"} as the
          agreement text above. Type each placeholder in one go without changing
          formatting mid-placeholder — simple split runs are handled, but a
          placeholder typed with formatting changes inside the braces may not be
          replaced. Unknown placeholders are left as-is in the generated file.
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload template"}
      </Button>
    </form>
  );
}
