/**
 * Pure config + validation for operator-defined CUSTOM application questions
 * (DB-free, unit-tested). These layer on top of the fixed APPLICATION_FIELDS
 * (form-config.ts): the operator groups extra questions into sections and the
 * public /apply form renders them. Supported input types include a single
 * yes/no checkbox and a multi-select checkbox list (e.g. "Which pets?").
 *
 * Untrusted JSON from AppSettings is always run through resolveCustomSections
 * before use, which clamps counts/lengths and drops malformed entries.
 */

export type QuestionType =
  | "short_text"
  | "long_text"
  | "yes_no"
  | "single_select"
  | "multi_select";

export const QUESTION_TYPES: readonly QuestionType[] = [
  "short_text",
  "long_text",
  "yes_no",
  "single_select",
  "multi_select",
] as const;

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  short_text: "Short text",
  long_text: "Paragraph",
  yes_no: "Yes / no checkbox",
  single_select: "Single choice",
  multi_select: "Checkbox list (multi-select)",
};

/** Types that carry a list of options the applicant chooses among. */
export function hasOptions(type: QuestionType): boolean {
  return type === "single_select" || type === "multi_select";
}

export interface CustomQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options: string[]; // only meaningful for select types
}

export interface CustomSection {
  id: string;
  title: string;
  description: string;
  questions: CustomQuestion[];
}

// Defensive limits so a bad/huge config can never blow up the public form.
const MAX_SECTIONS = 12;
const MAX_QUESTIONS = 25;
const MAX_OPTIONS = 30;
const MAX_LABEL = 200;
const MAX_OPTION = 120;
const MAX_DESC = 500;
// Cap a free-text answer from the public form so it can't be an unbounded blob.
const MAX_ANSWER = 2000;

let autoId = 0;
function makeId(prefix: string): string {
  autoId += 1;
  return `${prefix}_${Date.now().toString(36)}_${autoId}`;
}

function clampStr(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function asType(v: unknown): QuestionType {
  return QUESTION_TYPES.includes(v as QuestionType)
    ? (v as QuestionType)
    : "short_text";
}

function resolveOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of raw) {
    const opt = clampStr(o, MAX_OPTION);
    if (!opt || seen.has(opt)) continue; // drop blanks + duplicates
    seen.add(opt);
    out.push(opt);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

function resolveQuestion(raw: unknown, usedIds: Set<string>): CustomQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const label = clampStr(o.label, MAX_LABEL);
  if (!label) return null; // a question with no prompt is meaningless
  const type = asType(o.type);
  const options = hasOptions(type) ? resolveOptions(o.options) : [];
  // A select question with no options is degenerate — drop it.
  if (hasOptions(type) && options.length === 0) return null;

  let id = clampStr(o.id, 64);
  if (!id || usedIds.has(id)) id = makeId("q");
  usedIds.add(id);

  return { id, label, type, required: o.required === true, options };
}

/** Merge a stored (untrusted) sections config into a clean, clamped shape. */
export function resolveCustomSections(saved: unknown): CustomSection[] {
  if (!Array.isArray(saved)) return [];
  const sections: CustomSection[] = [];
  const usedSectionIds = new Set<string>();
  const usedQuestionIds = new Set<string>();

  for (const rawSection of saved) {
    if (!rawSection || typeof rawSection !== "object") continue;
    const s = rawSection as Record<string, unknown>;
    const title = clampStr(s.title, MAX_LABEL);
    const rawQuestions = Array.isArray(s.questions) ? s.questions : [];
    const questions: CustomQuestion[] = [];
    for (const rq of rawQuestions) {
      const q = resolveQuestion(rq, usedQuestionIds);
      if (q) questions.push(q);
      if (questions.length >= MAX_QUESTIONS) break;
    }
    // Drop a section with neither a title nor any questions.
    if (!title && questions.length === 0) continue;

    let id = clampStr(s.id, 64);
    if (!id || usedSectionIds.has(id)) id = makeId("s");
    usedSectionIds.add(id);

    sections.push({
      id,
      title: title || "Additional questions",
      description: clampStr(s.description, MAX_DESC),
      questions,
    });
    if (sections.length >= MAX_SECTIONS) break;
  }
  return sections;
}

/** The form field name for a question's input(s). */
export function questionInputName(questionId: string): string {
  return `cq_${questionId}`;
}

export type CustomAnswers = Record<string, string | string[]>;

/** True when an answer is non-empty (string filled, or at least one selection). */
export function isAnswered(answer: string | string[] | undefined): boolean {
  if (Array.isArray(answer)) return answer.length > 0;
  return typeof answer === "string" && answer.trim() !== "";
}

/**
 * Validate answers against the resolved sections. Returns the labels of
 * questions that are required-but-blank or have an out-of-list selection.
 * Empty array = valid.
 */
export function validateCustomAnswers(
  sections: CustomSection[],
  answers: CustomAnswers,
): string[] {
  const errors: string[] = [];
  for (const section of sections) {
    for (const q of section.questions) {
      const answer = answers[q.id];
      const answered = isAnswered(answer);
      if (q.required && !answered) {
        errors.push(q.label);
        continue;
      }
      if (answered && hasOptions(q.type)) {
        const allowed = new Set(q.options);
        const picked = Array.isArray(answer) ? answer : [answer as string];
        if (picked.some((p) => !allowed.has(p))) {
          errors.push(`${q.label} (invalid choice)`);
        }
      }
    }
  }
  return errors;
}

/** A display-ready answer snapshot, stored on the application for history. */
export interface AnswerSnapshotItem {
  label: string;
  value: string;
}

/**
 * Flatten answers into a label/value snapshot (skipping blanks). Stored on the
 * application so staff always see what was asked + answered even if the form
 * config later changes. Multi-selects join with ", "; yes/no renders Yes/No.
 */
export function buildAnswerSnapshot(
  sections: CustomSection[],
  answers: CustomAnswers,
): AnswerSnapshotItem[] {
  const out: AnswerSnapshotItem[] = [];
  for (const section of sections) {
    for (const q of section.questions) {
      const answer = answers[q.id];
      if (!isAnswered(answer)) continue;
      let value: string;
      if (q.type === "yes_no") {
        value = "Yes";
      } else if (Array.isArray(answer)) {
        // Choice values are validated against the option list (each <= MAX_OPTION).
        value = answer.join(", ");
      } else {
        // Free-text (short_text / paragraph) is otherwise unbounded — clamp it.
        value = (answer as string).trim().slice(0, MAX_ANSWER);
      }
      out.push({ label: q.label, value });
    }
  }
  return out;
}
