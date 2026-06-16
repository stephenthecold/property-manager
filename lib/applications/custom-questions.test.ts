import { describe, it, expect } from "vitest";
import {
  buildAnswerSnapshot,
  resolveCustomSections,
  validateCustomAnswers,
  type CustomSection,
} from "@/lib/applications/custom-questions";

const petsConfig = [
  {
    id: "s1",
    title: "Pets",
    description: "Tell us about any animals.",
    questions: [
      { id: "haspets", label: "Do you have pets?", type: "yes_no", required: false },
      {
        id: "which",
        label: "Which pets?",
        type: "multi_select",
        required: false,
        options: ["Dog", "Cat", "Bird", "Other"],
      },
    ],
  },
];

describe("resolveCustomSections", () => {
  it("keeps a well-formed pets section with a yes/no + checkbox list", () => {
    const sections = resolveCustomSections(petsConfig);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Pets");
    expect(sections[0].questions.map((q) => q.type)).toEqual([
      "yes_no",
      "multi_select",
    ]);
    expect(sections[0].questions[1].options).toEqual([
      "Dog",
      "Cat",
      "Bird",
      "Other",
    ]);
  });

  it("returns [] for non-array / garbage input", () => {
    expect(resolveCustomSections(null)).toEqual([]);
    expect(resolveCustomSections("nope")).toEqual([]);
    expect(resolveCustomSections({})).toEqual([]);
  });

  it("drops questions with no label and select questions with no options", () => {
    const sections = resolveCustomSections([
      {
        title: "X",
        questions: [
          { label: "", type: "short_text" },
          { label: "Pick", type: "single_select", options: [] },
          { label: "Good", type: "short_text" },
        ],
      },
    ]);
    expect(sections[0].questions.map((q) => q.label)).toEqual(["Good"]);
  });

  it("dedupes options and coerces unknown types to short_text", () => {
    const sections = resolveCustomSections([
      {
        title: "T",
        questions: [
          { label: "Q", type: "bogus", options: ["a", "a", "b"] },
        ],
      },
    ]);
    expect(sections[0].questions[0].type).toBe("short_text");
    // options are ignored for non-select types
    expect(sections[0].questions[0].options).toEqual([]);
  });

  it("assigns ids when missing or duplicated", () => {
    const sections = resolveCustomSections([
      { title: "A", questions: [{ label: "Q1", type: "short_text" }] },
      { title: "B", questions: [{ label: "Q2", type: "short_text" }] },
    ]);
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    expect(sections[0].questions[0].id).toBeTruthy();
  });
});

describe("validateCustomAnswers", () => {
  const sections: CustomSection[] = resolveCustomSections([
    {
      id: "s",
      title: "S",
      questions: [
        { id: "name", label: "Pet name", type: "short_text", required: true },
        {
          id: "kind",
          label: "Pet kind",
          type: "multi_select",
          required: false,
          options: ["Dog", "Cat"],
        },
      ],
    },
  ]);

  it("flags a required question left blank", () => {
    expect(validateCustomAnswers(sections, {})).toEqual(["Pet name"]);
  });

  it("passes when required answered and selections are valid", () => {
    expect(
      validateCustomAnswers(sections, { name: "Rex", kind: ["Dog"] }),
    ).toEqual([]);
  });

  it("rejects an out-of-list selection", () => {
    expect(
      validateCustomAnswers(sections, { name: "Rex", kind: ["Fish"] }),
    ).toEqual(["Pet kind (invalid choice)"]);
  });
});

describe("buildAnswerSnapshot", () => {
  const sections = resolveCustomSections(petsConfig);

  it("renders yes/no, joins multi-selects, and skips blanks", () => {
    const snap = buildAnswerSnapshot(sections, {
      haspets: "on",
      which: ["Dog", "Cat"],
    });
    expect(snap).toEqual([
      { label: "Do you have pets?", value: "Yes" },
      { label: "Which pets?", value: "Dog, Cat" },
    ]);
  });

  it("omits unanswered questions", () => {
    expect(buildAnswerSnapshot(sections, {})).toEqual([]);
  });
});
