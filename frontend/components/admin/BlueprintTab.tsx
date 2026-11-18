"use client";

import { useMemo, useState } from "react";

import { Alert, Button, Card, Input, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { BankSummaryRow, BlueprintItem, Difficulty, Exam } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { validateInteger } from "@/lib/validation";

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];

type BankCell = { count: number; marks: Record<string, number> };

/**
 * A blueprint row asks for approved questions of one topic and difficulty. Everything it may
 * ask for comes from the question bank: the topic must exist, the marks are the marks the
 * authors gave those questions (never typed in), and the number of questions can't exceed what
 * the bank holds.
 */
export function BlueprintTab({ exam, onChange }: { exam: Exam; onChange: (e: Exam) => void }) {
  const editable = exam.status === "draft" || exam.status === "sealed";
  const summary = useApi<BankSummaryRow[]>("/bank/summary");
  const [rows, setRows] = useState<BlueprintItem[]>(
    exam.blueprint.length
      ? exam.blueprint.map(({ topic, difficulty, count, marks }) => ({ topic, difficulty, count, marks }))
      : [{ topic: "", difficulty: "easy", count: 0, marks: null }],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // topic|difficulty -> approved count, broken down by marks.
  const bank = useMemo(() => {
    const m = new Map<string, BankCell>();
    for (const r of summary.data ?? []) {
      if (r.subject.toLowerCase() !== exam.subject.toLowerCase()) continue;
      m.set(`${r.topic.toLowerCase()}|${r.difficulty}`, { count: r.count, marks: r.marks ?? {} });
    }
    return m;
  }, [summary.data, exam.subject]);
  const topics = useMemo(
    () =>
      Array.from(
        new Set(
          (summary.data ?? [])
            .filter((r) => r.subject.toLowerCase() === exam.subject.toLowerCase())
            .map((r) => r.topic),
        ),
      ).sort(),
    [summary.data, exam.subject],
  );

  const cellOf = (r: BlueprintItem): BankCell | undefined => bank.get(`${r.topic.trim().toLowerCase()}|${r.difficulty}`);
  const marksOptions = (r: BlueprintItem): number[] =>
    Object.keys(cellOf(r)?.marks ?? {})
      .map(Number)
      .sort((a, b) => a - b);
  // Questions available for the row's exact topic, difficulty and marks.
  const availableFor = (r: BlueprintItem): number => {
    const cell = cellOf(r);
    if (!cell) return 0;
    return r.marks === null ? cell.count : (cell.marks[String(r.marks)] ?? 0);
  };

  /** After topic/difficulty/marks change: take the marks from the bank and fill the count. */
  function fit(r: BlueprintItem): BlueprintItem {
    const options = marksOptions(r);
    const marks = r.marks !== null && options.includes(r.marks) ? r.marks : (options[0] ?? null);
    const next = { ...r, marks };
    return { ...next, count: availableFor(next) };
  }

  const set = (i: number, patch: Partial<BlueprintItem>, refit = false) =>
    setRows(rows.map((r, j) => (i === j ? (refit ? fit({ ...r, ...patch }) : { ...r, ...patch }) : r)));

  async function save() {
    setMsg(null);
    const seen = new Set<string>();
    for (const [i, r] of rows.entries()) {
      const n = `Row ${i + 1}: `;
      if (!r.topic.trim()) return setMsg({ kind: "error", text: n + "choose a topic." });
      const cell = cellOf(r);
      if (!cell) {
        return setMsg({
          kind: "error",
          text: n + `the bank has no approved ${r.difficulty} "${r.topic}" questions for ${exam.subject}.`,
        });
      }
      if (r.marks === null || !(String(r.marks) in cell.marks)) {
        return setMsg({ kind: "error", text: n + "choose the marks from the question bank." });
      }
      const have = availableFor(r);
      const countError = validateInteger(r.count, 1, have, "Questions");
      if (countError) {
        return setMsg({
          kind: "error",
          text: n + `${countError} The bank holds ${have} approved ${r.difficulty} "${r.topic}" questions worth ${r.marks} mark${r.marks === 1 ? "" : "s"}.`,
        });
      }
      const key = `${r.topic.trim().toLowerCase()}|${r.difficulty}|${r.marks}`;
      if (seen.has(key)) return setMsg({ kind: "error", text: n + "this topic, difficulty and marks combination is repeated." });
      seen.add(key);
    }
    setBusy(true);
    try {
      const next = await api<Exam>(`/exams/${exam.id}/blueprint`, {
        method: "PUT",
        json: rows.map((r) => ({ ...r, topic: r.topic.trim() })),
      });
      onChange(next);
      setMsg({
        kind: "success",
        text:
          exam.status === "sealed"
            ? "Blueprint saved. The previous paper was discarded, so generate a new one."
            : "Blueprint saved. Next, generate the paper.",
      });
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const totalQuestions = rows.reduce((s, r) => s + (r.count || 0), 0);
  const totalMarks = rows.reduce((s, r) => s + (r.count || 0) * (r.marks ?? 0), 0);

  return (
    <Card>
      <p className="mb-4 text-sm text-slate-400">
        Each row takes approved <span className="text-slate-200">{exam.subject}</span> questions of one topic and
        difficulty from the question bank. Marks come from the questions themselves, and you can&apos;t ask for more
        questions than the bank holds.
      </p>
      <div className="space-y-2">
        <div className="hidden grid-cols-12 gap-2 px-1 text-xs uppercase tracking-wider text-slate-500 md:grid">
          <div className="col-span-4">Topic</div>
          <div className="col-span-2">Difficulty</div>
          <div className="col-span-2">Questions</div>
          <div className="col-span-2">Marks each</div>
          <div className="col-span-1">In bank</div>
        </div>
        {rows.map((r, i) => {
          const have = availableFor(r);
          const options = marksOptions(r);
          const topicChoices = r.topic && !topics.includes(r.topic) ? [r.topic, ...topics] : topics;
          return (
            <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-12">
              <Select
                className="col-span-2 md:col-span-4"
                disabled={!editable}
                value={r.topic}
                onChange={(e) => set(i, { topic: e.target.value, marks: null }, true)}
              >
                <option value="">Choose a topic…</option>
                {topicChoices.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Select
                className="md:col-span-2"
                disabled={!editable}
                value={r.difficulty}
                onChange={(e) => set(i, { difficulty: e.target.value as Difficulty, marks: null }, true)}
              >
                {DIFFS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
              <Input
                className="md:col-span-2"
                type="number"
                min={have ? 1 : 0}
                max={have}
                step={1}
                disabled={!editable || have === 0}
                value={r.count}
                title={`At most ${have}: the approved questions in the bank`}
                onChange={(e) => {
                  const n = Math.floor(Number(e.target.value));
                  set(i, { count: Number.isFinite(n) ? Math.min(Math.max(n, 0), have) : 0 });
                }}
              />
              {options.length > 1 ? (
                <Select
                  className="md:col-span-2"
                  disabled={!editable}
                  value={String(r.marks ?? options[0])}
                  onChange={(e) => set(i, { marks: Number(e.target.value) }, true)}
                  title="Marks set by the question authors"
                >
                  {options.map((m) => (
                    <option key={m} value={m}>
                      {m} mark{m === 1 ? "" : "s"} ({cellOf(r)?.marks[String(m)]} in bank)
                    </option>
                  ))}
                </Select>
              ) : (
                <div
                  className="flex items-center rounded-lg border border-slate-800 bg-slate-900/50 px-3 text-sm text-slate-300 md:col-span-2"
                  title="Marks set by the question authors"
                >
                  {r.marks !== null ? `${r.marks} mark${r.marks === 1 ? "" : "s"}` : "—"}
                </div>
              )}
              <div
                className={`flex items-center text-sm tabular-nums md:col-span-1 ${have > 0 && r.count <= have ? "text-emerald-300" : "text-amber-300"}`}
              >
                {have}
              </div>
              {editable && rows.length > 1 && (
                <button
                  className="text-left text-sm text-slate-500 hover:text-rose-300 md:col-span-1"
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              )}
            </div>
          );
        })}
      </div>
      {msg && (
        <div className="mt-4">
          <Alert kind={msg.kind}>{msg.text}</Alert>
        </div>
      )}
      {editable && (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => setRows([...rows, { topic: "", difficulty: "easy", count: 0, marks: null }])}
          >
            Add row
          </Button>
          <Button onClick={save} busy={busy} disabled={rows.some((r) => !r.topic.trim() || r.count < 1)}>
            Save blueprint
          </Button>
          <span className="text-sm text-slate-400">
            {totalQuestions} questions · {totalMarks} marks in total
          </span>
        </div>
      )}
    </Card>
  );
}
