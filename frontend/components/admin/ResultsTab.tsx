"use client";

import { Alert, Card, Loading, Stat, Table, Td } from "@/components/ui";
import { fmtDateTime, shortHash } from "@/lib/format";
import type { Exam, Results } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export function ResultsTab({ exam }: { exam: Exam }) {
  const results = useApi<Results>(exam.status === "closed" ? `/exams/${exam.id}/results` : null);

  if (exam.status !== "closed") {
    return <Alert kind="info">Results become available when the exam window closes.</Alert>;
  }
  if (results.loading) return <Loading />;
  if (results.error || !results.data) return <Alert>{results.error ?? "No results"}</Alert>;
  const r = results.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Candidates" value={r.candidates} />
        <Stat label="Average" value={r.average ?? "—"} hint={`out of ${r.total_marks ?? "—"}`} />
        <Stat label="Highest" value={r.highest ?? "—"} />
        <Stat label="Lowest" value={r.lowest ?? "—"} />
      </div>

      <Card>
        <h2 className="mb-4 font-medium text-white">Correct answers per question</h2>
        <div className="space-y-2">
          {r.per_question.map((q) => {
            const pct = q.correct_rate === null ? 0 : Math.round(q.correct_rate * 100);
            return (
              <div key={q.question_id} className="flex items-center gap-3 text-sm">
                <span className="w-10 text-slate-400">Q{q.number}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-cyan-400" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-32 text-right tabular-nums text-slate-300">
                  {pct}% · {q.correct}/{r.candidates}
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      <Table head={["Candidate", "Score", "Submitted", "Violations", "Receipt"]} empty="No attempts.">
        {r.attempts.map((a) => (
          <tr key={a.candidate_id}>
            <Td>
              {a.candidate_name}
              <div className="text-xs text-slate-500">{a.email}</div>
            </Td>
            <Td className="tabular-nums">
              {a.score ?? "—"} / {a.max_score ?? "—"}
            </Td>
            <Td>
              {fmtDateTime(a.submitted_at)}
              {a.auto_submitted && <div className="text-xs text-amber-300">auto-submitted</div>}
            </Td>
            <Td className={a.violations ? "tabular-nums text-rose-300" : "tabular-nums text-slate-500"}>{a.violations}</Td>
            <Td className="font-mono text-xs text-slate-400">
              <span title={a.answers_sha256 ?? ""}>{shortHash(a.answers_sha256)}</span>
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
