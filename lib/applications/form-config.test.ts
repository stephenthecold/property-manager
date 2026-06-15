import { describe, expect, it } from "vitest";
import {
  resolveFormConfig,
  validateSubmission,
  isShown,
  isRequired,
  APPLICATION_FIELDS,
} from "./form-config";

describe("resolveFormConfig", () => {
  it("defaults every field to optional", () => {
    const c = resolveFormConfig(null);
    for (const f of APPLICATION_FIELDS) expect(c[f.key]).toBe("optional");
  });

  it("honors saved modes and clamps unknown values", () => {
    const c = resolveFormConfig({ monthlyIncome: "required", employer: "hidden", bogus: "required", message: "nope" });
    expect(c.monthlyIncome).toBe("required");
    expect(c.employer).toBe("hidden");
    expect(c.message).toBe("optional"); // invalid → default
    expect("bogus" in c).toBe(false); // unknown dropped
  });

  it("never lets a contact method be hidden", () => {
    const c = resolveFormConfig({ email: "hidden", phone: "hidden" });
    expect(c.email).toBe("optional");
    expect(c.phone).toBe("optional");
  });
});

describe("validateSubmission", () => {
  const cfg = resolveFormConfig({ monthlyIncome: "required", employer: "hidden", currentAddress: "required" });

  it("flags blank required fields by label", () => {
    const errs = validateSubmission(cfg, { email: true });
    expect(errs).toContain("Monthly income");
    expect(errs).toContain("Current address");
  });

  it("passes when required fields are present", () => {
    const errs = validateSubmission(cfg, { email: true, monthlyIncome: true, currentAddress: true });
    expect(errs).toEqual([]);
  });

  it("requires at least one contact method", () => {
    const errs = validateSubmission(resolveFormConfig(null), {});
    expect(errs).toContain("Email or phone");
  });

  it("a hidden field is never required", () => {
    expect(isShown(cfg, "employer")).toBe(false);
    expect(isRequired(cfg, "employer")).toBe(false);
    const errs = validateSubmission(cfg, { phone: true, monthlyIncome: true, currentAddress: true });
    expect(errs).toEqual([]);
  });
});
