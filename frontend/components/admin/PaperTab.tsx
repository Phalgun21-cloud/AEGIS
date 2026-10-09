"use client";

import { useState } from "react";

import { Alert, Badge, Button, Card, Stat, Table, Td } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Exam, GenerateResponse, ManifestEntry, Shortfall } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export function PaperTab({ exam, onChange }: { exam: Exam; onChange: (e: Exam) => void }) {
  const manifest = useApi<ManifestEntry[]>(exam.paper_sha256 ? `/exams/${exam.id}/manifest` : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shortfalls, setShortfalls] = useState<Shortfall[] | null>(null);
  const [stats, setStats] = useState<{ pool: number; dupes: number } | null>(null);

  const canGenerate = exam.status === "draft" || exam.status === "sealed";

  async function generate() {
    if (exam.status === "sealed" && !confirm("Replace the sealed paper with a newly generated one?")) return;
    setBusy(true);
    setError(null);
    setShortfalls(null);
    try {
      const res = await api<GenerateResponse>(`/exams/${exam.id}/generate`, { method: "POST" });
      onChange(res.exam);
      manifest.setData(res.manifest);
      setStats({ pool: res.pool_size, dupes: res.duplicates_skipped });
    } catch (err) {
      const detail = err instanceof ApiError ? (err.detail as { shortfalls?: Shortfall[] }) : null;
      if (detail && typeof detail === "object" && detail.shortfalls) setShortfalls(detail.shortfalls);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const m = manifest.data ?? [];
  const byDifficulty = m.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q.difficulty]: (acc[q.difficulty] ?? 0) + 1 }), {});

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-medium text-white">AI-assisted generation</h2>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-slate-400">
          <li>Decrypts the approved {exam.subject} pool in server memory.</li>
          <li>Drops near-duplicate questions (TF-IDF similarity check).</li>
          <li>Fills each blueprint row by topic, difficulty and marks, using the least-used questions first.</li>
          <li>Seals the assembled paper with a new AES-256-GCM key, which can&apos;t be opened before release.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          The generator assists selection. Reviewers remain responsible for academic quality.
        </p>
        <div className="mt-5 flex items-center gap-3">
          <Button onClick={generate} busy={busy} disabled={!canGenerate || exam.blueprint.length === 0}>
            {exam.paper_sha256 ? "Regenerate paper" : "Generate & seal paper"}
          </Button>
          {exam.blueprint.length === 0 && <span className="text-sm text-amber-300">Save a blueprint first.</span>}
          {!canGenerate && <span className="text-sm text-slate-500">The paper is locked once released.</span>}
        </div>
        {error && (
          <div className="mt-4 space-y-3">
            <Alert>{error}</Alert>
            {shortfalls && (
              <Table head={["Topic", "Difficulty", "Marks", "Needed", "Available"]}>
                {shortfalls.map((s, i) => (
                  <tr key={i}>
                    <Td>{s.topic}</Td>
                    <Td>
                      <Badge value={s.difficulty} />
                    </Td>
                    <Td>{s.marks ?? "any"}</Td>
                    <Td className="tabular-nums">{s.required}</Td>
                    <Td className="tabular-nums text-amber-300">{s.available}</Td>
                  </tr>
                ))}
              </Table>
            )}
          </div>
        )}
      </Card>

      {exam.paper_sha256 && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Questions" value={m.length} />
            <Stat label="Total marks" value={exam.total_marks ?? "—"} />
            <Stat label="Easy / Med / Hard" value={`${byDifficulty.easy ?? 0}/${byDifficulty.medium ?? 0}/${byDifficulty.hard ?? 0}`} />
            <Stat
              label={stats ? "Pool / duplicates skipped" : "Generated"}
              value={stats ? `${stats.pool} / ${stats.dupes}` : <span className="text-base">{fmtDateTime(exam.generated_at)}</span>}
            />
          </div>
          <Card>
            <div className="text-xs uppercase tracking-wider text-slate-400">Sealed paper fingerprint (SHA-256)</div>
            <code className="mt-1 block break-all font-mono text-sm text-cyan-200">{exam.paper_sha256}</code>
            <p className="mt-2 text-xs text-slate-500">
              Recorded in the audit log. The manifest below lists what was selected, without any question content.
            </p>
          </Card>
          <Table head={["#", "Question ID", "Topic", "Difficulty", "Marks"]}>
            {m.map((q, i) => (
              <tr key={q.question_id}>
                <Td className="text-slate-500">{i + 1}</Td>
                <Td className="tabular-nums">#{q.question_id}</Td>
                <Td>{q.topic}</Td>
                <Td>
                  <Badge value={q.difficulty} />
                </Td>
                <Td className="tabular-nums">{q.marks}</Td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
