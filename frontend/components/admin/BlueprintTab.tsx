"use client";

import { useMemo, useState } from "react";

import { Alert, Button, Card, Input, Select } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import type { BankSummaryRow, BlueprintItem, Difficulty, Exam } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const DIFFS: Difficulty[] = ["easy", "medium", "hard"];

export function BlueprintTab({ exam, onChange }: { exam: Exam; onChange: (e: Exam) => void }) {
  const editable = exam.status === "draft" || exam.status === "sealed";
  const summary = useApi<BankSummaryRow[]>("/bank/summary");
  const [rows, setRows] = useState<BlueprintItem[]>(
    exam.blueprint.length
      ? exam.blueprint.map(({ topic, difficulty, count, marks }) => ({ topic, difficulty, count, marks }))
      : [{ topic: "", difficulty: "easy", count: 5, marks: null }],
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const available = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of summary.data ?? []) {
      if (r.subject.toLowerCase() !== exam.subject.toLowerCase()) continue;
      m.set(`${r.topic.toLowerCase()}|${r.difficulty}`, r.count);
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

  const set = (i: number, patch: Partial<BlueprintItem>) =>
    setRows(rows.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setMsg(null);
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

  return (
    <Card>
      <p className="mb-4 text-sm text-slate-400">
        Each row asks for a number of approved <span className="text-slate-200">{exam.subject}</span> questions
        of a given topic and difficulty. &ldquo;In bank&rdquo; shows how many approved questions match.
      </p>
      <datalist id="topics">
        {topics.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="space-y-2">
        <div className="hidden grid-cols-12 gap-2 px-1 text-xs uppercase tracking-wider text-slate-500 md:grid">
          <div className="col-span-4">Topic</div>
          <div className="col-span-2">Difficulty</div>
          <div className="col-span-2">Questions</div>
          <div className="col-span-2">Marks each</div>
          <div className="col-span-1">In bank</div>
        </div>
        {rows.map((r, i) => {
          const have = available.get(`${r.topic.trim().toLowerCase()}|${r.difficulty}`) ?? 0;
          return (
            <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-12">
              <Input
                className="col-span-2 md:col-span-4"
                list="topics"
                placeholder="Topic"
                disabled={!editable}
                value={r.topic}
                onChange={(e) => set(i, { topic: e.target.value })}
              />
              <Select
                className="md:col-span-2"
                disabled={!editable}
                value={r.difficulty}
                onChange={(e) => set(i, { difficulty: e.target.value as Difficulty })}
              >
                {DIFFS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </Select>
              <Input
                className="md:col-span-2"
                type="number"
                min={1}
                disabled={!editable}
                value={r.count}
                onChange={(e) => set(i, { count: Number(e.target.value) })}
              />
              <Input
                className="md:col-span-2"
                type="number"
                min={1}
                placeholder="any"
                disabled={!editable}
                value={r.marks ?? ""}
                onChange={(e) => set(i, { marks: e.target.value ? Number(e.target.value) : null })}
              />
              <div
                className={`flex items-center text-sm tabular-nums md:col-span-1 ${have >= r.count ? "text-emerald-300" : "text-amber-300"}`}
                title={r.marks ? "Count ignores the marks filter" : undefined}
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
          <Button variant="secondary" onClick={() => setRows([...rows, { topic: "", difficulty: "easy", count: 1, marks: null }])}>
            Add row
          </Button>
          <Button onClick={save} busy={busy} disabled={rows.some((r) => !r.topic.trim() || r.count < 1)}>
            Save blueprint
          </Button>
          <span className="text-sm text-slate-400">{totalQuestions} questions in total</span>
        </div>
      )}
    </Card>
  );
}
