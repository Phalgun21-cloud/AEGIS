"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CandidateSecurityVerification } from "@/components/CandidateSecurityVerification";
import { Alert, Badge, Button, Card, Loading, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtDuration, parseUtc } from "@/lib/format";
import type { Attempt, CandidateExam } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { enterFullscreen } from "@/lib/useProctoring";

export default function ExamInstructionsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const exams = useApi<CandidateExam[]>("/candidate/exams");
  const [now, setNow] = useState(() => Date.now());
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [securityVerified, setSecurityVerified] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const allExams = exams.data ?? [];
  const exam = allExams.find((e: CandidateExam) => e.id === Number(id));
  const opensIn = exam ? (parseUtc(exam.start_at).getTime() - now) / 1000 : 0;
  const hasEnded = exam ? parseUtc(exam.end_at).getTime() < now : false;
  const { reload } = exams;

  // Once countdown reaches zero, auto-refresh to update status to live
  const awaitingRelease = !!exam && exam.status !== "live" && exam.status !== "closed" && opensIn <= 0;
  useEffect(() => {
    if (!awaitingRelease) return;
    void reload();
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [awaitingRelease, reload]);

  // A finished attempt routes straight to its receipt
  useEffect(() => {
    if (exam?.submitted && exam.attempt_id) router.replace(`/candidate/attempt/${exam.attempt_id}`);
  }, [exam, router]);

  if (exams.loading && !exams.data) return <Loading />;
  if (exams.error) return <Alert kind="error">{exams.error}</Alert>;
  if (!exam) return <Alert kind="error">Examination record not found.</Alert>;

  if (exam.submitted) return <Loading label="Loading examination receipt…" />;

  async function start() {
    enterFullscreen();
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
    <div className="space-y-6">
      <Link href="/candidate" className="text-xs text-slate-400 hover:text-cyan-300">
        ← Back to Candidate Dashboard
      </Link>

      <PageHeader
        title={exam.title}
        subtitle={`${exam.subject} · Duration: ${exam.duration_minutes} minutes · Total Marks: 100`}
      />

      {/* Main Instructions & Security Check Layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Instructions Card */}
          <Card className="border-cyan-500/20 bg-[#071126]/90 p-6 space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-cyan-300">
              Official Examination Protocol &amp; Instructions
            </h2>
            <p className="whitespace-pre-wrap text-slate-200 text-sm leading-relaxed">
              {exam.instructions || "Read each question carefully. Your answers are cryptographically hashed and saved."}
            </p>

            <div className="rounded-xl border border-slate-800 bg-black/40 p-4 space-y-2 text-xs text-slate-300">
              <div className="font-semibold text-white">Critical Assessment Rules:</div>
              <ul className="list-inside list-disc space-y-1.5 text-slate-400">
                <li>Your countdown timer initiates authoritatively when you launch the examination.</li>
                <li>Each candidate receives a stabilized randomized question sequence when shuffling is enabled.</li>
                <li>Answers are persisted and mapped to invariant question identifiers in real time.</li>
                <li>Departing fullscreen, blur events, or switching tabs logs an immutable proctoring violation.</li>
                <li>When the scheduled end time expires, remaining answers are submitted automatically.</li>
              </ul>
            </div>
          </Card>

          {/* Mandatory Camera & Two-Stage Biometric Face Verification + Microphone Test */}
          {!resuming && (
            <CandidateSecurityVerification onVerified={setSecurityVerified} />
          )}
        </div>

        {/* Examination Access Gatekeeper Card */}
        <div className="space-y-4">
          <Card className="border-cyan-500/25 bg-[#071126]/95 p-6 space-y-5">
            <div className="border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-white">Assessment Schedule</h3>
              <p className="text-xs text-slate-400">Authoritative UTC synchronization</p>
            </div>

            <dl className="space-y-3 text-xs font-mono">
              <div className="flex justify-between">
                <dt className="text-slate-400">Opens At</dt>
                <dd className="text-slate-200">{fmtDateTime(exam.start_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Closes At</dt>
                <dd className="text-slate-200">{fmtDateTime(exam.end_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Duration</dt>
                <dd className="text-cyan-300">{exam.duration_minutes} Minutes</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">Paper Marks</dt>
                <dd className="text-cyan-300 font-bold">100 Marks</dd>
              </div>
            </dl>

            <div className="border-t border-slate-800 pt-4">
              {hasEnded || exam.status === "closed" ? (
                <Alert kind="error">
                  Examination Closed: This examination has concluded. Further access or submissions are permanently blocked.
                </Alert>
              ) : opensIn > 0 && exam.status !== "live" ? (
                <div className="rounded-xl border border-cyan-500/30 bg-black/50 p-4 text-center space-y-1">
                  <div className="text-[11px] uppercase tracking-wider text-slate-400 font-medium">
                    Earliest Permitted Entry In
                  </div>
                  <div className="font-mono text-3xl tabular-nums font-bold text-cyan-300">
                    {fmtDuration(opensIn)}
                  </div>
                  <p className="text-[11px] text-slate-500 pt-1">
                    Early entry is strictly prevented by schedule rules.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {!resuming && (
                    <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        className="mt-0.5 accent-cyan-400 rounded h-4 w-4"
                      />
                      <span>
                        I certify that I am the registered candidate and agree to adhere to all honor code regulations.
                      </span>
                    </label>
                  )}

                  {error && <Alert kind="error">{error}</Alert>}

                  <Button
                    className="w-full py-3 text-sm font-semibold shadow-lg shadow-cyan-500/20"
                    variant="primary"
                    onClick={start}
                    busy={busy}
                    disabled={
                      !resuming &&
                      (!agreed || !securityVerified)
                    }
                  >
                    {resuming ? "Resume Active Examination →" : "Launch Examination Environment →"}
                  </Button>

                  {!resuming && !securityVerified && (
                    <p className="text-[11px] text-center text-amber-300/80">
                      ⚠ Complete Two-Stage Face Verification and Microphone Testing to unlock Launch button.
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
