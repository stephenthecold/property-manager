import { describe, it, expect } from "vitest";
import {
  DEFAULT_TEMPLATES,
  buildReminderVars,
  renderTemplate,
} from "@/lib/reminders/templates";

function vars() {
  return buildReminderVars({
    tenantFirstName: "Ada",
    tenantLastName: "Lovelace",
    propertyName: "Maple Court",
    unitLabel: "Unit 2B",
    amountDueFormatted: "$1,250.00",
    dueDateFormatted: "June 1, 2026",
    balanceFormatted: "$450.00",
  });
}

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    expect(
      renderTemplate("Hi {{first_name}}, rent is {{amount_due}}.", vars()),
    ).toBe("Hi Ada, rent is $1,250.00.");
  });

  it("accepts whitespace inside the braces", () => {
    expect(renderTemplate("{{ first_name }}", vars())).toBe("Ada");
    expect(renderTemplate("{{first_name }}", vars())).toBe("Ada");
    expect(renderTemplate("{{ first_name}}", vars())).toBe("Ada");
    expect(renderTemplate("{{  first_name  }}", vars())).toBe("Ada");
  });

  it("renders unknown keys as empty string", () => {
    expect(renderTemplate("a{{nope}}b {{ also_nope }}c", vars())).toBe(
      "ab c",
    );
  });

  it("does not re-expand placeholders contained in variable values", () => {
    const out = renderTemplate("Hello {{name}}", {
      name: "{{first_name}}",
      first_name: "Ada",
    });
    expect(out).toBe("Hello {{first_name}}");
  });

  it("leaves text without placeholders untouched", () => {
    expect(renderTemplate("No braces here.", vars())).toBe("No braces here.");
  });
});

describe("buildReminderVars", () => {
  it("exposes exactly the documented keys", () => {
    expect(vars()).toEqual({
      tenant_name: "Ada Lovelace",
      first_name: "Ada",
      property: "Maple Court",
      unit: "Unit 2B",
      amount_due: "$1,250.00",
      due_date: "June 1, 2026",
      balance: "$450.00",
    });
  });
});

describe("DEFAULT_TEMPLATES", () => {
  it("covers every ReminderType and manual is empty (UI-supplied)", () => {
    expect(Object.keys(DEFAULT_TEMPLATES).sort()).toEqual([
      "manual",
      "partial_balance",
      "payment_receipt",
      "rent_due_soon",
      "rent_overdue",
    ]);
    expect(DEFAULT_TEMPLATES.manual).toBe("");
  });

  it("every body renders cleanly with buildReminderVars output", () => {
    for (const [type, body] of Object.entries(DEFAULT_TEMPLATES)) {
      const rendered = renderTemplate(body, vars());
      expect(rendered, `template ${type}`).not.toContain("{{");
      expect(rendered, `template ${type}`).not.toContain("}}");
      if (type !== "manual") {
        expect(rendered).toContain("Ada");
      }
    }
  });
});
