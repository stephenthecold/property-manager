import type { TemplateVars } from "@/lib/reminders/templates";

/**
 * Lease AMENDMENT / addendum document — a signed rider that modifies an existing
 * lease (a pet addendum, a mid-term rent rider, an added-occupant clause, …).
 *
 * It rides the SAME e-sign engine as a lease/renewal: `createSigningRequest`
 * renders this template once through {@link renderTemplate} with the lease's
 * agreement vars, the signature-marker passthrough, and the per-amendment
 * overrides below. The render is SINGLE-PASS, so the staff-typed title/body are
 * inserted as literal VALUES and can never re-expand into other `{{vars}}` or
 * signature markers — see lib/reminders/templates.ts. Pure string logic; no DB.
 *
 * Unlike a renewal, an amendment applies NO terms automatically — it is purely a
 * signed record, so it never touches the ledger, rent, or lease dates.
 */

/** Var keys this template injects beyond the standard agreement vars. */
export const AMENDMENT_TITLE_VAR = "amendment_title";
export const AMENDMENT_BODY_VAR = "amendment_body";

/** Length bounds for the staff-entered title/body (validated in the service). */
export const AMENDMENT_TITLE_MAX = 120;
export const AMENDMENT_BODY_MAX = 8000;

/**
 * The amendment document template. References only vars that
 * {@link buildAgreementVars} provides (business_legal_name, tenant_names,
 * property_name, unit, start_date, today) plus the two amendment vars and the
 * inline `{{landlord_signature}}` / `{{tenant_signatures}}` markers the engine
 * stamps at completion. No `{{tenant_initials}}` marker, so signing an amendment
 * captures a single signature per party (no separate initials step).
 */
export const AMENDMENT_TEMPLATE = `LEASE AMENDMENT

{{${AMENDMENT_TITLE_VAR}}}

This Amendment is made on {{today}} between {{business_legal_name}} ("Landlord") and {{tenant_names}} ("Tenant"), and amends the Residential Lease Agreement dated {{start_date}} for {{property_name}}, Unit {{unit}} (the "Lease").

For good and valuable consideration, the Landlord and Tenant agree as follows:

{{${AMENDMENT_BODY_VAR}}}

Except as expressly modified above, all other terms and conditions of the Lease remain in full force and effect. In the event of any conflict between this Amendment and the Lease, this Amendment controls.

By signing below, the parties acknowledge and agree to this Amendment as of {{today}}.

Landlord: {{landlord_signature}}

Tenant: {{tenant_signatures}}`;

/**
 * The per-amendment var overrides handed to `createSigningRequest`. The values
 * are inserted literally by the single-pass renderer (injection-safe). Trimmed
 * here so leading/trailing whitespace never bloats the signed document.
 */
export function amendmentVarOverrides(input: {
  title: string;
  body: string;
}): TemplateVars {
  return {
    [AMENDMENT_TITLE_VAR]: input.title.trim(),
    [AMENDMENT_BODY_VAR]: input.body.trim(),
  };
}

/** The fixed header line the template opens with; the title is the next line. */
const AMENDMENT_HEADER = "LEASE AMENDMENT";

/**
 * Recover the human title from a rendered amendment document — the first
 * non-empty line after the {@link AMENDMENT_HEADER}. The title isn't stored on a
 * column (an amendment is just a SigningRequest), so the list panel reads it
 * back from the frozen documentText. Kept beside the template it parses so the
 * two evolve together; falls back to "Amendment" for any unexpected shape.
 */
export function extractAmendmentTitle(documentText: string): string {
  const lines = documentText.split("\n").map((l) => l.trim());
  const headerIdx = lines.indexOf(AMENDMENT_HEADER);
  for (let i = headerIdx >= 0 ? headerIdx + 1 : 0; i < lines.length; i++) {
    if (lines[i]) return lines[i];
  }
  return "Amendment";
}

export type AmendmentInputError = "title_required" | "title_too_long" | "body_required" | "body_too_long";

/** Validate the staff-entered title/body. Pure — the service maps codes to copy. */
export function validateAmendmentInput(input: {
  title: string;
  body: string;
}): { ok: true } | { ok: false; error: AmendmentInputError } {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length === 0) return { ok: false, error: "title_required" };
  if (title.length > AMENDMENT_TITLE_MAX) return { ok: false, error: "title_too_long" };
  if (body.length === 0) return { ok: false, error: "body_required" };
  if (body.length > AMENDMENT_BODY_MAX) return { ok: false, error: "body_too_long" };
  return { ok: true };
}
