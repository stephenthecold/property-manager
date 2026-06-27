"use client";

import { useActionState, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  QUESTION_TYPES,
  QUESTION_TYPE_LABELS,
  hasOptions,
  type CustomQuestion,
  type CustomSection,
  type QuestionType,
} from "@/lib/applications/custom-questions";
import {
  saveCustomSectionsAction,
  type ApplicationSettingsState,
} from "./actions";

/** Browser-side id for new sections/questions; the server re-sanitizes anyway. */
function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function emptyQuestion(): CustomQuestion {
  return { id: newId("q"), label: "", type: "short_text", required: false, options: [] };
}

/**
 * Add/edit/remove custom question sections for the public /apply form. State is
 * serialized to a hidden JSON field on submit; the action re-sanitizes it.
 */
export function CustomQuestionsBuilder({
  initial,
}: {
  initial: CustomSection[];
}) {
  const [sections, setSections] = useState<CustomSection[]>(initial);
  const [state, action, pending] = useActionState<ApplicationSettingsState, FormData>(
    saveCustomSectionsAction,
    {},
  );

  const patchSection = (si: number, patch: Partial<CustomSection>) =>
    setSections((prev) =>
      prev.map((s, i) => (i === si ? { ...s, ...patch } : s)),
    );

  const patchQuestion = (si: number, qi: number, patch: Partial<CustomQuestion>) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si
          ? {
              ...s,
              questions: s.questions.map((q, j) =>
                j === qi ? { ...q, ...patch } : q,
              ),
            }
          : s,
      ),
    );

  const addSection = () =>
    setSections((prev) => [
      ...prev,
      { id: newId("s"), title: "", description: "", questions: [emptyQuestion()] },
    ]);

  const removeSection = (si: number) =>
    setSections((prev) => prev.filter((_, i) => i !== si));

  const addQuestion = (si: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, questions: [...s.questions, emptyQuestion()] } : s,
      ),
    );

  const removeQuestion = (si: number, qi: number) =>
    setSections((prev) =>
      prev.map((s, i) =>
        i === si
          ? { ...s, questions: s.questions.filter((_, j) => j !== qi) }
          : s,
      ),
    );

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sectionsJson" value={JSON.stringify(sections)} />

      {state.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state.ok && (
        <Alert>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}

      <p className="text-sm text-muted-foreground">
        Add your own questions grouped into sections — e.g. a “Pets” section with
        a yes/no checkbox and a checkbox list of animals. Choices for the “single
        choice” and “checkbox list” types go one per line.
      </p>

      {sections.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          No custom questions yet. The form shows only the standard fields above.
        </p>
      )}

      {sections.map((section, si) => (
        <div key={section.id} className="space-y-3 rounded-md border p-3">
          <div className="flex items-start gap-2">
            <div className="grid flex-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`sec-title-${section.id}`}>Section title</Label>
                <Input
                  id={`sec-title-${section.id}`}
                  value={section.title}
                  placeholder="e.g. Pets"
                  onChange={(e) => patchSection(si, { title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`sec-desc-${section.id}`}>
                  Section description (optional)
                </Label>
                <Input
                  id={`sec-desc-${section.id}`}
                  value={section.description}
                  placeholder="Shown under the section heading"
                  onChange={(e) => patchSection(si, { description: e.target.value })}
                />
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="mt-7"
              onClick={() => removeSection(si)}
            >
              Remove section
            </Button>
          </div>

          <div className="space-y-3">
            {section.questions.map((q, qi) => (
              <div key={q.id} className="space-y-2 rounded-md border bg-muted/30 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <Label htmlFor={`q-label-${q.id}`}>Question</Label>
                    <Input
                      id={`q-label-${q.id}`}
                      value={q.label}
                      placeholder="e.g. Do you have pets?"
                      onChange={(e) => patchQuestion(si, qi, { label: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="mt-7"
                    onClick={() => removeQuestion(si, qi)}
                  >
                    Remove
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`q-type-${q.id}`}>Type</Label>
                    <select
                      id={`q-type-${q.id}`}
                      value={q.type}
                      onChange={(e) =>
                        patchQuestion(si, qi, { type: e.target.value as QuestionType })
                      }
                      className="h-9 w-full rounded-md border px-3 text-sm"
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {QUESTION_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={q.required}
                      onChange={(e) =>
                        patchQuestion(si, qi, { required: e.target.checked })
                      }
                      className="size-4"
                    />
                    Required
                  </label>
                </div>

                {hasOptions(q.type) && (
                  <div className="space-y-2">
                    <Label htmlFor={`q-opts-${q.id}`}>Choices (one per line)</Label>
                    <textarea
                      id={`q-opts-${q.id}`}
                      value={q.options.join("\n")}
                      rows={3}
                      placeholder={"Dog\nCat\nBird"}
                      onChange={(e) =>
                        patchQuestion(si, qi, {
                          options: e.target.value.split("\n"),
                        })
                      }
                      className="w-full rounded-md border p-2 text-sm"
                    />
                  </div>
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => addQuestion(si)}
            >
              + Add question
            </Button>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addSection}>
          + Add section
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save custom questions"}
        </Button>
      </div>
    </form>
  );
}
