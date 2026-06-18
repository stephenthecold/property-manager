import { describe, it, expect } from "vitest";
import { slaState } from "@/lib/maintenance/sla";

// All comparisons are whole-UTC-day based, so build date-only values at UTC
// midnight just like the persisted dueDate.
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const now = utc("2026-06-18");

describe("slaState", () => {
  it("flags a past due date as overdue with negative days", () => {
    const r = slaState({ status: "in_progress", dueDate: utc("2026-06-15"), now });
    expect(r.state).toBe("overdue");
    expect(r.daysUntilDue).toBe(-3);
  });

  it("treats yesterday as overdue (just past the boundary)", () => {
    const r = slaState({ status: "pending", dueDate: utc("2026-06-17"), now });
    expect(r.state).toBe("overdue");
    expect(r.daysUntilDue).toBe(-1);
  });

  it("treats today (0 days out) as due_soon", () => {
    const r = slaState({ status: "assigned", dueDate: utc("2026-06-18"), now });
    expect(r.state).toBe("due_soon");
    expect(r.daysUntilDue).toBe(0);
  });

  it("is due_soon exactly at the 2-day boundary", () => {
    const r = slaState({ status: "on_hold", dueDate: utc("2026-06-20"), now });
    expect(r.state).toBe("due_soon");
    expect(r.daysUntilDue).toBe(2);
  });

  it("is on_track just past the due_soon window (3 days out)", () => {
    const r = slaState({ status: "pending", dueDate: utc("2026-06-21"), now });
    expect(r.state).toBe("on_track");
    expect(r.daysUntilDue).toBe(3);
  });

  it("returns none for terminal statuses even when a due date is set", () => {
    expect(slaState({ status: "completed", dueDate: utc("2026-06-01"), now })).toEqual({
      state: "none",
      daysUntilDue: null,
    });
    expect(slaState({ status: "canceled", dueDate: utc("2026-06-01"), now })).toEqual({
      state: "none",
      daysUntilDue: null,
    });
  });

  it("returns none when there is no due date", () => {
    expect(slaState({ status: "in_progress", dueDate: null, now })).toEqual({
      state: "none",
      daysUntilDue: null,
    });
  });
});
