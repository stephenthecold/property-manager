import { describe, expect, it } from "vitest";
import { mergeActivity, type ActivityEvent } from "@/lib/activity/merge";

const ev = (
  id: string,
  at: string,
  over: Partial<ActivityEvent> = {},
): ActivityEvent => ({
  id,
  at: new Date(at),
  kind: "audit",
  title: id,
  ...over,
});

describe("mergeActivity", () => {
  it("flattens groups and sorts newest-first", () => {
    const out = mergeActivity([
      [ev("a", "2026-01-01T00:00:00Z"), ev("b", "2026-03-01T00:00:00Z")],
      [ev("c", "2026-02-01T00:00:00Z")],
    ]);
    expect(out.map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("returns an empty array for no groups and for all-empty groups", () => {
    expect(mergeActivity([])).toEqual([]);
    expect(mergeActivity([[], []])).toEqual([]);
  });

  it("ignores empty groups while keeping populated ones", () => {
    const out = mergeActivity([
      [],
      [ev("x", "2026-05-01T00:00:00Z")],
      [],
    ]);
    expect(out.map((e) => e.id)).toEqual(["x"]);
  });

  it("breaks ties on identical timestamps by id ascending (deterministic)", () => {
    const t = "2026-04-01T12:00:00Z";
    const out = mergeActivity([
      [ev("zebra", t), ev("alpha", t)],
      [ev("mike", t)],
    ]);
    expect(out.map((e) => e.id)).toEqual(["alpha", "mike", "zebra"]);
  });

  it("does not mutate the input groups", () => {
    const group = [ev("a", "2026-01-01T00:00:00Z"), ev("b", "2026-02-01T00:00:00Z")];
    const snapshot = group.map((e) => e.id);
    mergeActivity([group]);
    expect(group.map((e) => e.id)).toEqual(snapshot);
  });
});
