/**
 * Pure config for the public rental-application form (DB-free) — unit-tested.
 *
 * The operator chooses, per field, whether it is hidden / optional / required
 * (Settings → Applications). firstName + lastName are ALWAYS required and not
 * configurable. email/phone are always shown (can't be hidden) and the form
 * always enforces "at least one of email or phone" so a prospect is reachable.
 */

export type FieldMode = "hidden" | "optional" | "required";

export interface ApplicationField {
  key: string;
  label: string;
  /** A contact method — always shown; "hidden" is coerced to "optional". */
  contact?: boolean;
}

/** Configurable fields, in form order. Name is implicit (always required). */
export const APPLICATION_FIELDS: readonly ApplicationField[] = [
  { key: "email", label: "Email", contact: true },
  { key: "phone", label: "Phone", contact: true },
  { key: "currentAddress", label: "Current address" },
  { key: "desiredMoveInDate", label: "Desired move-in date" },
  { key: "monthlyIncome", label: "Monthly income" },
  { key: "employer", label: "Employer" },
  { key: "message", label: "Anything else / notes" },
] as const;

export type ApplicationFormConfig = Record<string, FieldMode>;

const DEFAULT_MODE: FieldMode = "optional";

/** Merge a stored (untrusted) config with defaults, clamped to known fields. */
export function resolveFormConfig(saved: unknown): ApplicationFormConfig {
  const obj = saved && typeof saved === "object" ? (saved as Record<string, unknown>) : {};
  const out: ApplicationFormConfig = {};
  for (const f of APPLICATION_FIELDS) {
    const raw = obj[f.key];
    let mode: FieldMode =
      raw === "hidden" || raw === "optional" || raw === "required" ? raw : DEFAULT_MODE;
    // Contact methods are always shown so the form can enforce reachability.
    if (f.contact && mode === "hidden") mode = "optional";
    out[f.key] = mode;
  }
  return out;
}

export function isShown(config: ApplicationFormConfig, key: string): boolean {
  return config[key] !== "hidden";
}
export function isRequired(config: ApplicationFormConfig, key: string): boolean {
  return config[key] === "required";
}

/**
 * Validate a submission against the config. `present[key]` = the field has a
 * non-empty value. Returns the human labels of REQUIRED fields left blank, plus
 * the contact-method rule. Empty array = valid.
 */
export function validateSubmission(
  config: ApplicationFormConfig,
  present: Record<string, boolean>,
): string[] {
  const errors: string[] = [];
  for (const f of APPLICATION_FIELDS) {
    if (isRequired(config, f.key) && !present[f.key]) {
      errors.push(f.label);
    }
  }
  // Always reachable: at least one contact method (when both are shown).
  const emailShown = isShown(config, "email");
  const phoneShown = isShown(config, "phone");
  if ((emailShown || phoneShown) && !present.email && !present.phone) {
    if (!errors.includes("Email") && !errors.includes("Phone")) {
      errors.push("Email or phone");
    }
  }
  return errors;
}
