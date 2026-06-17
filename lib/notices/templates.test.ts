import { describe, expect, it } from "vitest";
import {
  NOTICE_TYPES,
  buildNoticeVars,
  defaultNoticeBody,
  isNoticeType,
  noticeTypeLabel,
  parseNoticeType,
  renderDefaultNotice,
} from "@/lib/notices/templates";

const vars = buildNoticeVars({
  tenantName: "Jane Doe",
  propertyName: "Maple Court",
  unitLabel: "2B",
  landlordName: "Acme Rentals",
  balanceFormatted: "$1,200.00",
  effectiveDateFormatted: "July 1, 2026",
  dateFormatted: "June 17, 2026",
});

describe("notices/templates", () => {
  it("recognizes and parses notice types", () => {
    for (const t of NOTICE_TYPES) expect(isNoticeType(t)).toBe(true);
    expect(isNoticeType("eviction")).toBe(false);
    expect(parseNoticeType("late_rent")).toBe("late_rent");
    expect(parseNoticeType("nope")).toBe("general");
  });

  it("labels every type", () => {
    expect(noticeTypeLabel("notice_to_quit")).toBe("Notice to quit / termination");
    for (const t of NOTICE_TYPES) expect(noticeTypeLabel(t).length).toBeGreaterThan(0);
  });

  it("fills variables into the rendered default notice", () => {
    const { subject, body } = renderDefaultNotice("late_rent", vars);
    expect(subject).toBe("Notice to Pay Rent or Vacate");
    expect(body).toContain("Jane Doe");
    expect(body).toContain("Maple Court");
    expect(body).toContain("Unit 2B");
    expect(body).toContain("$1,200.00");
    expect(body).toContain("July 1, 2026");
    expect(body).toContain("Acme Rentals");
    // No unrendered placeholders remain.
    expect(body).not.toMatch(/\{\{|\}\}/);
  });

  it("renders an effective-date placeholder when none supplied", () => {
    const v = buildNoticeVars({
      tenantName: "X",
      propertyName: "P",
      unitLabel: "1",
      landlordName: "L",
      dateFormatted: "June 17, 2026",
    });
    expect(v.effective_date).toBe("________");
  });

  it("exposes a non-empty default body for every type", () => {
    for (const t of NOTICE_TYPES) expect(defaultNoticeBody(t).length).toBeGreaterThan(0);
  });
});
