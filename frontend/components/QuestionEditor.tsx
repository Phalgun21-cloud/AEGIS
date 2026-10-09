"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { api, apiBlobUrl, errorMessage } from "@/lib/api";
import type { Difficulty, Question, QuestionInput } from "@/lib/types";

const EMPTY: QuestionInput = {
  subject: "",
  topic: "",
  difficulty: "easy",
  marks: 1,
  stem: "",
  options: ["", "", "", ""],
  correct_option: 0,
  explanation: null,
};

function toInput(q: Question): QuestionInput {
  return {
    subject: q.subject,
    topic: q.topic,
    difficulty: q.difficulty,
    marks: q.marks,
    stem: q.stem ?? "",
    options: q.options ?? ["", ""],
    correct_option: q.correct_option ?? 0,
    explanation: q.explanation,
  };
}

export function QuestionEditor({ question }: { question?: Question }) {
  const router = useRouter();
  const [q, setQ] = useState<Question | undefined>(question);
  const [form, setForm] = useState<QuestionInput>(question ? toInput(question) : EMPTY);
  const [busy, setBusy] = useState<"save" | "submit" | "image" | "delete" | null>(null);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const editable = !q || q.status === "draft" || q.status === "rejected";

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

  const setOption = (i: number, v: string) =>
    setForm({ ...form, options: form.options.map((o, j) => (i === j ? v : o)) });

  function removeOption(i: number) {
    const options = form.options.filter((_, j) => j !== i);
    let correct = form.correct_option;
    if (i === correct) correct = 0;
    else if (i < correct) correct -= 1;
    setForm({ ...form, options, correct_option: correct });
  }

  async function save(navigate = true): Promise<Question | null> {
    const body = { ...form, explanation: form.explanation?.trim() || null };
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
      await save();
      setMsg({ kind: "success", text: "Draft saved." });
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
      setQ(await api<Question>(`/questions/${saved.id}/submit`, { method: "POST" }));
      if (!q) router.replace(`/author/${saved.id}`);
      setMsg({ kind: "success", text: "Submitted for review. It's now locked until a reviewer responds." });
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
    if (!q || !confirm("Delete this draft permanently?")) return;
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
      <Card>
        <div className="flex items-center gap-3">
          <Badge value="approved" />
          <span className="text-sm text-slate-400">
            {q.subject} · {q.topic} · {q.difficulty} · {q.marks} mark{q.marks === 1 ? "" : "s"}
          </span>
        </div>
        <p className="mt-4 text-sm text-slate-300">
          This question was approved and its content is now sealed in the encrypted vault. It can&apos;t be
          viewed or edited through the portal.
        </p>
        {q.review_feedback && <p className="mt-2 text-sm text-slate-400">Reviewer note: {q.review_feedback}</p>}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {q && (
        <div className="flex flex-wrap items-center gap-3">
          <Badge value={q.status} label={q.status === "rejected" ? "needs changes" : undefined} />
          <span className="text-sm text-slate-500">Question #{q.id}</span>
        </div>
      )}
      {q?.status === "rejected" && q.review_feedback && (
        <Alert>
          <div className="font-medium">Reviewer feedback</div>
          <div className="mt-1 whitespace-pre-wrap">{q.review_feedback}</div>
        </Alert>
      )}
      {q?.status === "submitted" && <Alert kind="info">This question is with a reviewer. It is locked until they respond.</Alert>}

      <Card>
        <div className="grid gap-4 md:grid-cols-4">
          <Field label="Subject">
            <Input disabled={!editable} required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </Field>
          <Field label="Topic">
            <Input disabled={!editable} required value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
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
          <Field label="Marks">
            <Input
              type="number"
              min={1}
              max={100}
              disabled={!editable}
              value={form.marks}
              onChange={(e) => setForm({ ...form, marks: Number(e.target.value) })}
            />
          </Field>
        </div>

        <div className="mt-6">
          <Field label="Question">
            <Textarea
              disabled={!editable}
              className="min-h-32"
              value={form.stem}
              onChange={(e) => setForm({ ...form, stem: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            Options. Select the correct answer.
          </div>
          <div className="space-y-2">
            {form.options.map((o, i) => (
              <div key={i} className="flex items-center gap-3">
                <input
                  type="radio"
                  name="correct"
                  aria-label={`Option ${String.fromCharCode(65 + i)} is correct`}
                  disabled={!editable}
                  checked={form.correct_option === i}
                  onChange={() => setForm({ ...form, correct_option: i })}
                  className="h-4 w-4 accent-emerald-400"
                />
                <span className="w-5 text-sm font-medium text-slate-400">{String.fromCharCode(65 + i)}</span>
                <Input disabled={!editable} value={o} onChange={(e) => setOption(i, e.target.value)} />
                {editable && form.options.length > 2 && (
                  <button className="text-sm text-slate-500 hover:text-rose-300" onClick={() => removeOption(i)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
          {editable && form.options.length < 8 && (
            <button
              className="mt-2 text-sm text-cyan-300 hover:underline"
              onClick={() => setForm({ ...form, options: [...form.options, ""] })}
            >
              + Add option
            </button>
          )}
        </div>

        <div className="mt-6">
          <Field label="Explanation (optional)" hint="Seen by reviewers. Never shown to candidates.">
            <Textarea
              disabled={!editable}
              value={form.explanation ?? ""}
              onChange={(e) => setForm({ ...form, explanation: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-6">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Diagram / image</div>
          {!q ? (
            <p className="text-sm text-slate-500">Save the draft first to attach an image.</p>
          ) : (
            <div className="flex flex-wrap items-start gap-4">
              {imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="Question diagram" className="max-h-48 rounded-lg border border-slate-700" />
              )}
              {editable && (
                <div className="space-y-2">
                  <label className="inline-flex cursor-pointer items-center rounded-lg border border-cyan-500/40 px-4 py-2 text-sm text-cyan-200 hover:bg-cyan-500/10">
                    {busy === "image" ? "Uploading…" : q.has_image ? "Replace image" : "Upload image"}
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
                    <button className="block text-sm text-slate-500 hover:text-rose-300" onClick={removeImage}>
                      Remove image
                    </button>
                  )}
                  <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 2 MB.</p>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {msg && <Alert kind={msg.kind}>{msg.text}</Alert>}

      {editable && (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onSave} busy={busy === "save"} disabled={busy !== null}>
            Save draft
          </Button>
          <Button onClick={onSubmit} busy={busy === "submit"} disabled={busy !== null}>
            Submit for review
          </Button>
          {q && (
            <Button variant="ghost" className="ml-auto" onClick={onDelete} busy={busy === "delete"} disabled={busy !== null}>
              Delete draft
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
