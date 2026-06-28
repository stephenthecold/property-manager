"use client";

import { FormDialog } from "@/components/app/form-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAmendmentAction } from "./actions";

/**
 * Pop-out form for a new lease amendment / addendum. FormDialog owns the form +
 * submit button and shows any validation error inline; on success it closes and
 * refreshes so the new amendment appears in the panel's list. Submitting SENDS
 * the rider to every tenant for e-signature immediately.
 */
export function AmendmentForm({ leaseId }: { leaseId: string }) {
  return (
    <FormDialog
      trigger="Add amendment"
      triggerVariant="default"
      title="New lease amendment"
      description="A signed rider that modifies this lease — e.g. a pet or parking addendum, or a mid-term rent change. All other lease terms stay in effect."
      action={createAmendmentAction}
      submitLabel="Send for signature"
      wide
    >
      <input type="hidden" name="leaseId" value={leaseId} />
      <div className="space-y-2">
        <Label htmlFor="amendment-title">Title</Label>
        <Input
          id="amendment-title"
          name="title"
          placeholder="e.g. Pet addendum"
          maxLength={120}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="amendment-body">Amendment text</Label>
        <Textarea
          id="amendment-body"
          name="body"
          rows={8}
          placeholder="Describe the change this amendment makes — e.g. “Tenant may keep one (1) cat. A non-refundable pet fee of $300 applies.”"
          required
        />
        <p className="text-xs text-muted-foreground">
          Each tenant gets a private signing link by SMS/email; your saved
          landlord signature is applied automatically.
        </p>
      </div>
    </FormDialog>
  );
}
