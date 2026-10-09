"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Alert, Button, Card, Loading, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtDuration, parseUtc } from "@/lib/format";
import type { Attempt, CandidateExam } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function ExamInstructionsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const exams = useApi<CandidateExam[]>("/candidate/exams");
  const [now, setNow] = useState(() => Date.now());
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const exam = exams.data?.find((e) => e.id === Number(id));
  const opensIn = exam ? (parseUtc(exam.start_at).getTime() - now) / 1000 : 0;
  const { reload } = exams;

  // When the countdown reaches zero, refresh so the Start button appears.
  useEffect(() => {
    if (exam && exam.status !== "live" && exam.status !== "closed" && opensIn <= 0 && opensIn > -5) {
      void reload();
    }
  }, [exam, opensIn, reload]);

  // A finished attempt goes straight to its receipt.
  useEffect(() => {
    if (exam?.submitted && exam.attempt_id) router.replace(`/candidate/attempt/${exam.attempt_id}`);
  }, [exam, router]);

  if (exams.loading && !exams.data) return <Loading />;
  if (exams.error) return <Alert>{exams.error}</Alert>;
  if (!exam) return <Alert>Exam not found.</Alert>;

  if (exam.submitted) return <Loading />;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const attempt = await api<Attempt>(`/candidate/exams/${id}/start`, { method: "POST" });
      router.push(`/candidate/attempt/${attempt.attempt_id}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  const resuming = exam.attempt_id !== null;

  return (
    <>
      <Link href="/candidate" className="text-sm text-slate-400 hover:text-slate-200">
        ← My exams
      </Link>
      <div className="mt-3">
        <PageHeader title={exam.title} subtitle={`${exam.subject} · ${exam.duration_minutes} minutes`} />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-400">Instructions</h2>
          <p className="whitespace-pre-wrap text-slate-200">{exam.instructions || "No special instructions."}</p>
          <ul className="mt-6 list-inside list-disc space-y-1.5 text-sm text-slate-400">
            <li>Your timer starts when you press Start and keeps running if you close the page.</li>
            <li>Your answers are saved automatically as you go.</li>
            <li>When time runs out, your saved answers are submitted automatically.</li>
            <li>You can submit only once. After submitting, answers can&apos;t be changed.</li>
          </ul>
        </Card>
        <Card className="h-fit">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Opens</dt>
              <dd>{fmtDateTime(exam.start_at)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Closes</dt>
              <dd>{fmtDateTime(exam.end_at)}</dd>
            </div>
          </dl>
          <div className="mt-6">
            {exam.status === "closed" ? (
              <Alert kind="info">This exam has closed.</Alert>
            ) : exam.status !== "live" ? (
              <div className="text-center">
                <div className="text-xs uppercase tracking-wider text-slate-500">Opens in</div>
                <div className="mt-1 font-mono text-3xl tabular-nums text-cyan-200">
                  {opensIn > 0 ? fmtDuration(opensIn) : "any moment…"}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {!resuming && (
                  <label className="flex items-start gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="mt-0.5 accent-cyan-400"
                    />
                    I have read the instructions and I&apos;m ready to begin.
                  </label>
                )}
                {error && <Alert>{error}</Alert>}
                <Button className="w-full" onClick={start} busy={busy} disabled={!resuming && !agreed}>
                  {resuming ? "Resume exam" : "Start exam"}
                </Button>
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
