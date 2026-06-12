"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import {
  generateFromTemplateAction,
  type GenerateDocxState,
} from "./actions";

/**
 * Print-hidden control-bar form: fills the uploaded .docx lease template for
 * this lease and surfaces a signed download link on success. Errors come back
 * as returned state (never thrown).
 */
export function GenerateDocxForm({
  leaseId,
  hasTemplate,
}: {
  leaseId: string;
  hasTemplate: boolean;
}) {
  const [state, formAction, pending] = useActionState<GenerateDocxState, FormData>(
    generateFromTemplateAction,
    {},
  );

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="leaseId" value={leaseId} />
      <Button type="submit" variant="outline" disabled={pending || !hasTemplate}>
        {pending ? "Generating…" : "Generate .docx"}
      </Button>
      {!hasTemplate && (
        <span className="text-sm text-muted-foreground">
          Upload a .docx template under Settings → Leases to enable this.
        </span>
      )}
      {state.error && (
        <span className="text-sm text-destructive">{state.error}</span>
      )}
      {state.ok &&
        (state.downloadUrl ? (
          <a
            href={state.downloadUrl}
            download={state.fileName}
            className="text-sm font-medium underline underline-offset-4"
          >
            Download {state.fileName}
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">
            {state.message} Find it on the Documents page.
          </span>
        ))}
    </form>
  );
}
