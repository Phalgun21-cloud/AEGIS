"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Badge, Button, Card, Field, Input, Select, Textarea, ValidatedInput, ValidatedTextarea } from "@/components/ui";
import { api, apiBlobUrl, errorMessage } from "@/lib/api";
import type { Difficulty, Question, QuestionInput, QuestionType } from "@/lib/types";
import { validateField } from "@/lib/validation";

const EMPTY: QuestionInput = {
  subject: "",
  topic: "",
  difficulty: "easy",
  marks: 2,
  negative_marks: 0.5,
  question_type: "mcq_single",
  stem: "",
  options: ["", "", "", ""],
  correct_option: 0,
  correct_options: [0],
  correct_text: "",
  tolerance: 0,
  max_words: 250,
  explanation: null,
};

function toInput(q: Question): QuestionInput {
  return {
    subject: q.subject,
    topic: q.topic,
    difficulty: q.difficulty,
    marks: q.marks,
    negative_marks: q.negative_marks ?? 0,
    question_type: q.question_type ?? (q.options ? "mcq_single" : "short_answer"),
    stem: q.stem ?? "",
    options: q.options ?? ["", ""],
    correct_option: q.correct_option ?? 0,
    correct_options: q.correct_options ?? [q.correct_option ?? 0],
    correct_text: q.correct_text ?? "",
    tolerance: q.tolerance ?? 0,
    max_words: q.max_words ?? 250,
    explanation: q.explanation,
  };
}

export function QuestionEditor({ question }: { question?: Question }) {
  const router = useRouter();
  const [q, setQ] = useState<Question | undefined>(question);
  const [form, setForm] = useState<QuestionInput>(question ? toInput(question) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "submit" | "image" | "delete" | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success" | "warning"; text: string } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const editable = !q || q.status === "draft" || q.status === "rejected";
  const qType = form.question_type ?? "mcq_single";

  useEffect(() => {
    if (!q?.has_image) {
      setImageUrl(null);
      return;
    }
    let url: string | null = null;
    void apiBlobUrl(`/questions/${q.id}/image?v=${q.updated_at}`).then((u) => {
      url = u;
      setImageUrl(u);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [q?.id, q?.has_image, q?.updated_at]);

  const setOption = (i: number, v: string) => {
    const updated = form.options.map((o, j) => (i === j ? v : o));
    setForm({ ...form, options: updated });
    if (errors[`opt_${i}`]) {
      const next = { ...errors };
      delete next[`opt_${i}`];
      delete next.duplicate_options;
      setErrors(next);
    }
  };

  function removeOption(i: number) {
    const options = form.options.filter((_, j) => j !== i);
    let correct = form.correct_option;
    if (i === correct) correct = 0;
    else if (i < correct) correct -= 1;
    setForm({ ...form, options, correct_option: correct });
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};

    const subVal = validateField("subject_name", form.subject, true);
    if (!subVal.isValid) newErrors.subject = subVal.error!;

    const topVal = validateField("topic_name", form.topic, true);
    if (!topVal.isValid) newErrors.topic = topVal.error!;

    const stemVal = validateField("question_text", form.stem, true);
    if (!stemVal.isValid) newErrors.stem = stemVal.error!;

    if (!form.marks || Number(form.marks) <= 0) newErrors.marks = "Marks must be a positive number.";

    if (qType === "mcq_single" || qType === "mcq_multiple") {
      if (form.options.length < 2) {
        newErrors.options = "At least two options are required.";
      }
      form.options.forEach((opt, idx) => {
        const optVal = validateField("question_option", opt, true);
        if (!optVal.isValid) {
          newErrors[`opt_${idx}`] = `Option ${String.fromCharCode(65 + idx)}: ${optVal.error}`;
        }
      });

      // Duplicate options detection
      const trimmedOpts = form.options.map((o) => o.trim().toLowerCase()).filter(Boolean);
      const uniqueOpts = new Set(trimmedOpts);
      if (uniqueOpts.size < trimmedOpts.length) {
        newErrors.duplicate_options = "Duplicate answer options are not permitted.";
      }
    }

    if (qType === "numerical") {
      if (form.correct_text === "" || Number.isNaN(Number(form.correct_text))) {
        newErrors.correct_text = "Valid numeric answer is required.";
      }
    }

    if (qType === "short_answer" && !form.correct_text?.trim()) {
      newErrors.correct_text = "Expected answer text is required.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function save(navigate = true): Promise<Question | null> {
    if (!validate()) {
      setMsg({ kind: "error", text: "Please correct the form validation errors before saving." });
      return null;
    }

    const body = {
      ...form,
      explanation: form.explanation?.trim() || null,
      options: (qType === "mcq_single" || qType === "mcq_multiple") ? form.options : [],
    };

    if (!q) {
      const created = await api<Question>("/questions", { json: body });
      setQ(created);
      if (navigate) router.replace(`/author/${created.id}`);
      return created;
    }
    const updated = await api<Question>(`/questions/${q.id}`, { method: "PATCH", json: body });
    setQ(updated);
    return updated;
  }

  async function onSave() {
    setBusy("save");
    setMsg(null);
    try {
      const saved = await save();
      if (saved) setMsg({ kind: "success", text: "Question draft successfully saved." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onSubmit() {
    setBusy("submit");
    setMsg(null);
    try {
      const saved = await save(false);
      if (!saved) return;
      const res = await api<Question>(`/questions/${saved.id}/submit`, { method: "POST" });
      setQ(res);
      setMsg({
        kind: "success",
        text: "Question submitted for review. It is now locked awaiting review approval.",
      });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onImage(file: File | undefined) {
    if (!file || !q) return;
    setBusy("image");
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setQ(await api<Question>(`/questions/${q.id}/image`, { method: "PUT", form: fd }));
      setMsg({ kind: "success", text: "Question diagram uploaded." });
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function removeImage() {
    if (!q) return;
    setBusy("image");
    try {
      setQ(await api<Question>(`/questions/${q.id}/image`, { method: "DELETE" }));
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!q || !confirm("Delete this draft question permanently?")) return;
    setBusy("delete");
    try {
      await api(`/questions/${q.id}`, { method: "DELETE" });
      router.push("/author");
    } catch (e) {
      setMsg({ kind: "error", text: errorMessage(e) });
      setBusy(null);
    }
  }

  if (q?.status === "approved") {
    return (
      <Card className="p-8 bg-[#071126] border-emerald-500/30">
        <div className="flex items-center gap-3">
          <Badge value="approved" />
          <span className="text-sm font-semibold text-slate-200">
            {q.subject} · {q.topic} · {q.difficulty} · {q.marks} mark{q.marks === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-4 text-sm text-slate-300">
          This question has been approved and its content is cryptographically sealed in the AEGIS Vault.
          Admins see only metadata; content cannot be decrypted until exam start time.
        </p>
        {q.review_feedback && (
          <p className="mt-3 text-xs text-slate-400 bg-white/[0.02] p-3 rounded-lg border border-slate-800">
            Reviewer Note: {q.review_feedback}
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {q && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge value={q.status} label={q.status === "rejected" ? "Needs Changes" : undefined} />
          <span className="text-sm font-mono text-slate-400">Question #{q.id}</span>
        </div>
      )}

      {q?.status === "rejected" && q.review_feedback && (
        <Alert kind="error">
          <div className="font-semibold">Reviewer Revision Feedback</div>
          <div className="mt-1 whitespace-pre-wrap text-sm">{q.review_feedback}</div>
        </Alert>
      )}

      {q?.status === "submitted" && (
        <Alert kind="info">
          This question is in the review queue. It is locked until a reviewer approves or requests revisions.
        </Alert>
      )}

      <Card className="p-6 bg-[#071126]/90 border-cyan-500/20">
        {/* Classification and Metadata Grid */}
        <div className="grid gap-4 md:grid-cols-5">
          <Field label="Subject" required error={errors.subject}>
            <ValidatedInput
              disabled={!editable}
              placeholder="e.g. Computer Science"
              minLength={2}
              maxLength={80}
              value={form.subject}
              error={errors.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </Field>
          <Field label="Topic" required error={errors.topic}>
            <ValidatedInput
              disabled={!editable}
              placeholder="e.g. Cryptography"
              minLength={2}
              maxLength={80}
              value={form.topic}
              error={errors.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
            />
          </Field>
          <Field label="Difficulty">
            <Select
              disabled={!editable}
              value={form.difficulty}
              onChange={(e) => setForm({ ...form, difficulty: e.target.value as Difficulty })}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </Select>
          </Field>
          <Field label="Marks" required error={errors.marks}>
            <Input
              type="number"
              min={1}
              max={100}
              disabled={!editable}
              value={form.marks}
              onChange={(e) => setForm({ ...form, marks: Number(e.target.value) })}
            />
          </Field>
          <Field label="Negative Marks">
            <Input
              type="number"
              step="0.25"
              min={0}
              max={50}
              disabled={!editable}
              value={form.negative_marks ?? 0}
              onChange={(e) => setForm({ ...form, negative_marks: Number(e.target.value) })}
            />
          </Field>
        </div>

        {/* Question Type Selector */}
        <div className="mt-6 border-t border-slate-800 pt-5">
          <Field label="Question Format">
            <Select
              disabled={!editable}
              value={qType}
              onChange={(e) => setForm({ ...form, question_type: e.target.value as QuestionType })}
            >
              <option value="mcq_single">Multiple Choice (Single Correct Answer)</option>
              <option value="mcq_multiple">Multiple Choice (Multiple Correct Answers / Checkboxes)</option>
              <option value="true_false">True / False</option>
              <option value="numerical">Numerical Value (with Tolerance)</option>
              <option value="short_answer">Short Answer (Exact / Text Match)</option>
              <option value="long_answer">Long Answer / Descriptive (Manual Evaluation)</option>
            </Select>
          </Field>
        </div>

        {/* Question Stem */}
        <div className="mt-6">
          <Field label="Question Statement / Stem" required error={errors.stem}>
            <ValidatedTextarea
              disabled={!editable}
              rows={4}
              minLength={10}
              maxLength={2000}
              placeholder="Type your examination question stem here…"
              value={form.stem}
              error={errors.stem}
              onChange={(e) => setForm({ ...form, stem: e.target.value })}
            />
          </Field>
        </div>

        {/* Options Editor for MCQ */}
        {(qType === "mcq_single" || qType === "mcq_multiple") && (
          <div className="mt-6 border-t border-slate-800 pt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Options & Correct Answer Selection
              </span>
              {errors.duplicate_options && (
                <span className="text-xs text-rose-400 font-semibold">{errors.duplicate_options}</span>
              )}
            </div>

            <div className="space-y-3">
              {form.options.map((o, i) => {
                const isSingleCorrect = form.correct_option === i;
                const isMultiCorrect = form.correct_options?.includes(i);

                return (
                  <div key={i} className="flex items-center gap-3">
                    {qType === "mcq_single" ? (
                      <input
                        type="radio"
                        name="correct_option"
                        aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                        disabled={!editable}
                        checked={isSingleCorrect}
                        onChange={() => setForm({ ...form, correct_option: i })}
                        className="h-4 w-4 accent-emerald-400"
                        title="Mark as correct answer"
                      />
                    ) : (
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={isMultiCorrect}
                        onChange={() => {
                          const currentList = form.correct_options ?? [];
                          const updated = currentList.includes(i)
                            ? currentList.filter((x) => x !== i)
                            : [...currentList, i];
                          setForm({ ...form, correct_options: updated });
                        }}
                        className="h-4 w-4 accent-emerald-400 rounded"
                        title="Include in correct answers"
                      />
                    )}

                    <span className="w-5 text-sm font-semibold text-slate-400">
                      {String.fromCharCode(65 + i)}
                    </span>

                    <div className="flex-1">
                      <ValidatedInput
                        disabled={!editable}
                        placeholder={`Option ${String.fromCharCode(65 + i)}`}
                        minLength={1}
                        maxLength={500}
                        value={o}
                        error={errors[`opt_${i}`]}
                        onChange={(e) => setOption(i, e.target.value)}
                      />
                    </div>

                    {editable && form.options.length > 2 && (
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-rose-300 p-1"
                        onClick={() => removeOption(i)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {editable && form.options.length < 8 && (
              <button
                type="button"
                className="mt-3 text-xs text-cyan-300 hover:text-cyan-200 font-medium"
                onClick={() => setForm({ ...form, options: [...form.options, ""] })}
              >
                + Add Option
              </button>
            )}
          </div>
        )}

        {/* True / False Correct Selection */}
        {qType === "true_false" && (
          <div className="mt-6 border-t border-slate-800 pt-5">
            <Field label="Correct Statement Value">
              <Select
                disabled={!editable}
                value={form.correct_option ?? 0}
                onChange={(e) => setForm({ ...form, correct_option: Number(e.target.value) })}
              >
                <option value={0}>True</option>
                <option value={1}>False</option>
              </Select>
            </Field>
          </div>
        )}

        {/* Numerical Answer Settings */}
        {qType === "numerical" && (
          <div className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-800 pt-5">
            <Field label="Expected Numeric Value" required error={errors.correct_text}>
              <Input
                type="number"
                step="any"
                disabled={!editable}
                placeholder="e.g. 3.1415"
                value={form.correct_text ?? ""}
                onChange={(e) => setForm({ ...form, correct_text: e.target.value })}
              />
            </Field>
            <Field label="Accepted Error Tolerance (±)">
              <Input
                type="number"
                step="any"
                min={0}
                disabled={!editable}
                value={form.tolerance ?? 0}
                onChange={(e) => setForm({ ...form, tolerance: Number(e.target.value) })}
              />
            </Field>
          </div>
        )}

        {/* Short Answer Match */}
        {qType === "short_answer" && (
          <div className="mt-6 border-t border-slate-800 pt-5">
            <Field label="Expected Exact / Normalized Match" required error={errors.correct_text}>
              <Input
                type="text"
                disabled={!editable}
                placeholder="e.g. Photosynthesis"
                value={form.correct_text ?? ""}
                onChange={(e) => setForm({ ...form, correct_text: e.target.value })}
              />
            </Field>
          </div>
        )}

        {/* Long Answer Word Limit */}
        {qType === "long_answer" && (
          <div className="mt-6 border-t border-slate-800 pt-5">
            <Field label="Maximum Candidate Word Limit">
              <Input
                type="number"
                min={50}
                max={2000}
                disabled={!editable}
                value={form.max_words ?? 250}
                onChange={(e) => setForm({ ...form, max_words: Number(e.target.value) })}
              />
            </Field>
          </div>
        )}

        {/* Explanation for Reviewers */}
        <div className="mt-6 border-t border-slate-800 pt-5">
          <Field
            label="Internal Author Explanation"
            hint="Reviewed during quality checks; strictly never exposed to candidates."
          >
            <Textarea
              disabled={!editable}
              rows={2}
              placeholder="Provide solution rationale or reference text…"
              value={form.explanation ?? ""}
              onChange={(e) => setForm({ ...form, explanation: e.target.value })}
            />
          </Field>
        </div>

        {/* Diagram Upload */}
        <div className="mt-6 border-t border-slate-800 pt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
            Diagram / Attached Image
          </div>
          {!q ? (
            <p className="text-xs text-slate-500">Save draft first to attach an image file.</p>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt="Question Diagram"
                  className="max-h-48 rounded-lg border border-slate-700 bg-black/40"
                />
              )}
              {editable && (
                <div className="space-y-2">
                  <label className="inline-flex cursor-pointer items-center rounded-lg border border-cyan-500/40 px-4 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/10 transition">
                    {busy === "image" ? "Uploading…" : q.has_image ? "Replace Image" : "Upload Image"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        void onImage(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {q.has_image && (
                    <button
                      type="button"
                      className="block text-xs text-rose-400 hover:underline"
                      onClick={removeImage}
                    >
                      Remove Diagram
                    </button>
                  )}
                  <p className="text-[11px] text-slate-500">PNG, JPEG or WebP up to 2 MB.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={onSave}
            busy={busy === "save"}
            disabled={busy !== null}
          >
            Save Draft
          </Button>
          <Button
            variant="primary"
            onClick={onSubmit}
            busy={busy === "submit"}
            disabled={busy !== null}
          >
            Submit for Review
          </Button>
          {q && (
            <Button
              variant="ghost"
              className="ml-auto text-rose-400 hover:text-rose-200 hover:bg-rose-500/10"
              onClick={onDelete}
              busy={busy === "delete"}
              disabled={busy !== null}
            >
              Delete Draft
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
