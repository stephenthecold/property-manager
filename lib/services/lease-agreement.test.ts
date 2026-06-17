import { describe, expect, it } from "vitest";
import { signatureMarkerDocxVars } from "@/lib/services/lease-agreement";
import type { ResolvedAppSettings } from "@/lib/services/app-settings";
import type { TemplateVars } from "@/lib/reminders/templates";

/**
 * signatureMarkerDocxVars is the bridge that keeps inline signature markers
 * from surviving as literal "{{landlord_signature}}" text in a generated .docx:
 * the saved landlord signature is applied as its typed name + derived initials,
 * tenants get their printed names, and everything degrades to "" (never the
 * raw tag) when nothing is saved.
 */
const app = (over: Partial<ResolvedAppSettings>): ResolvedAppSettings =>
  ({ landlordSignatureName: null, ...over }) as ResolvedAppSettings;

const vars = (tenantNames: string): TemplateVars =>
  ({ tenant_names: tenantNames }) as unknown as TemplateVars;

describe("signatureMarkerDocxVars", () => {
  it("applies the saved landlord signature name and derived initials", () => {
    const out = signatureMarkerDocxVars(
      app({ landlordSignatureName: "Kevin de la Cruz" }),
      vars("Jane Doe, John Roe"),
    );
    expect(out.landlord_signature).toBe("Kevin de la Cruz");
    expect(out.landlord_initials).toBe("KDLC");
  });

  it("fills tenant signatures with the printed names; tenant initials stay blank", () => {
    const out = signatureMarkerDocxVars(
      app({ landlordSignatureName: "Acme LLC" }),
      vars("Jane Doe, John Roe"),
    );
    expect(out.tenant_signatures).toBe("Jane Doe, John Roe");
    expect(out.tenant_initials).toBe("");
  });

  it("yields empty strings (never literal tags) when no signature is saved", () => {
    const out = signatureMarkerDocxVars(app({}), vars("Jane Doe"));
    expect(out.landlord_signature).toBe("");
    expect(out.landlord_initials).toBe("");
    // Every marker is a known key, so substitutePlaceholders replaces (not keeps) it.
    for (const key of [
      "landlord_signature",
      "landlord_initials",
      "tenant_signatures",
      "tenant_initials",
    ]) {
      expect(out).toHaveProperty(key);
    }
  });
});
