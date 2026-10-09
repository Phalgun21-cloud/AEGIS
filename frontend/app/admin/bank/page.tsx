"use client";

import { useMemo, useState } from "react";

import { Alert, Badge, Card, Loading, PageHeader, Select, Table, Td } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { BankSummaryRow, QuestionMeta } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function BankPage() {
  const summary = useApi<BankSummaryRow[]>("/bank/summary");
  const [subject, setSubject] = useState("");
  const bank = useApi<QuestionMeta[]>(`/bank${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`);

  const subjects = useMemo(
    () => Array.from(new Set((summary.data ?? []).map((r) => r.subject))).sort(),
    [summary.data],
  );

  // subject -> topic -> {easy, medium, hard}
  const grid = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const r of summary.data ?? []) {
      if (subject && r.subject !== subject) continue;
      const key = `${r.subject} › ${r.topic}`;
      const row = m.get(key) ?? {};
      row[r.difficulty] = r.count;
      m.set(key, row);
    }
    return Array.from(m.entries());
  }, [summary.data, subject]);

  return (
    <>
      <PageHeader
        title="Question Bank"
        subtitle="Approved questions are encrypted in the vault. Only their metadata is shown here."
        actions={
          <Select className="w-56" value={subject} onChange={(e) => setSubject(e.target.value)}>
            <option value="">All subjects</option>
            {subjects.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        }
      />
      {summary.error && <Alert>{summary.error}</Alert>}

      <Card className="mb-8">
        <h2 className="mb-1 font-medium text-white">Coverage for blueprint planning</h2>
        <p className="mb-4 text-sm text-slate-400">Approved questions per topic and difficulty.</p>
        {summary.loading ? (
          <Loading />
        ) : (
          <Table head={["Subject › Topic", "Easy", "Medium", "Hard"]} empty="No approved questions yet.">
            {grid.map(([k, row]) => (
              <tr key={k}>
                <Td>{k}</Td>
                {(["easy", "medium", "hard"] as const).map((d) => (
                  <Td key={d} className="tabular-nums">
                    {row[d] ?? <span className="text-slate-600">0</span>}
                  </Td>
                ))}
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Table head={["ID", "Subject / Topic", "Difficulty", "Marks", "Used in papers", "Approved"]} empty="No approved questions.">
        {(bank.data ?? []).map((q) => (
          <tr key={q.id}>
            <Td className="tabular-nums text-slate-400">#{q.id}</Td>
            <Td>
              {q.subject}
              <div className="text-xs text-slate-500">{q.topic}</div>
            </Td>
            <Td>
              <Badge value={q.difficulty} />
            </Td>
            <Td className="tabular-nums">{q.marks}</Td>
            <Td className="tabular-nums">{q.usage_count}</Td>
            <Td>{fmtDateTime(q.reviewed_at)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
