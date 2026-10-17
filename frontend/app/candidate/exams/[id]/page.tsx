"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Alert, Button, Card, Loading, PageHeader } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtDuration, parseUtc } from "@/lib/format";
import type { Attempt, CandidateExam } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { enterFullscreen, openCameraAndMic, watchLevel } from "@/lib/useProctoring";

export default function ExamInstructionsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const exams = useApi<CandidateExam[]>("/candidate/exams");
  const [now, setNow] = useState(() => Date.now());
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devicesOk, setDevicesOk] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const exam = exams.data?.find((e) => e.id === Number(id));
  const opensIn = exam ? (parseUtc(exam.start_at).getTime() - now) / 1000 : 0;
  const { reload } = exams;

  // Once the countdown reaches zero, keep refreshing until the exam is released, so the Start
  // button appears even if the server was slow (e.g. waking up) at the release second.
  const awaitingRelease = !!exam && exam.status !== "live" && exam.status !== "closed" && opensIn <= 0;
  useEffect(() => {
    if (!awaitingRelease) return;
    void reload();
    const t = setInterval(() => void reload(), 5000);
    return () => clearInterval(t);
  }, [awaitingRelease, reload]);

  // A finished attempt goes straight to its receipt.
  useEffect(() => {
    if (exam?.submitted && exam.attempt_id) router.replace(`/candidate/attempt/${exam.attempt_id}`);
  }, [exam, router]);

  if (exams.loading && !exams.data) return <Loading />;
  if (exams.error) return <Alert>{exams.error}</Alert>;
  if (!exam) return <Alert>Exam not found.</Alert>;

  if (exam.submitted) return <Loading />;

  async function start() {
    // Must run inside the click itself: browsers only allow full screen from a user gesture.
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
  const needsCheck = exam.media_required && !resuming;

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
                {needsCheck && <DeviceCheck onReady={setDevicesOk} />}
                <p className="text-xs text-slate-500">
                  The exam opens in full screen. Leaving full screen, switching tabs or windows is recorded as a
                  violation{exam.media_required ? ", and your camera and microphone stay on throughout" : ""}.
                </p>
                {error && <Alert>{error}</Alert>}
                <Button
                  className="w-full"
                  onClick={start}
                  busy={busy}
                  disabled={!resuming && (!agreed || (needsCheck && !devicesOk))}
                >
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


/** Camera and microphone check before starting: asks for permission once, shows a preview. */
function DeviceCheck({ onReady }: { onReady: (ok: boolean) => void }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const video = useRef<HTMLVideoElement | null>(null);

  async function check() {
    setError(null);
    try {
      const s = await openCameraAndMic();
      setStream(s);
      onReady(true);
    } catch (e) {
      setError(errorMessage(e));
      onReady(false);
    }
  }

  useEffect(() => {
    if (!stream) return;
    if (video.current) {
      video.current.srcObject = stream;
      void video.current.play().catch(() => {});
    }
    const stopLevel = watchLevel(stream, setLevel);
    return () => {
      stopLevel();
      stream.getTracks().forEach((t) => t.stop()); // the exam page opens its own
    };
  }, [stream]);

  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <div className="text-xs uppercase tracking-wider text-slate-400">Camera and microphone</div>
      {stream ? (
        <>
          <video ref={video} muted playsInline className="mt-2 aspect-[4/3] w-full -scale-x-100 rounded bg-black object-cover" />
          <div className="mt-2 flex items-center gap-2 text-xs text-emerald-300">
            Working. Speak to test the microphone:
            <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800">
              <span className="block h-full bg-emerald-400" style={{ width: `${Math.min(100, level * 400)}%` }} />
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-400">
            This exam is proctored: your camera and microphone must stay on, and the exam admin sees camera snapshots.
          </p>
          {error && <p className="mt-2 text-xs text-amber-300">{error}</p>}
          <Button variant="secondary" className="mt-3 w-full" onClick={check}>
            Allow camera and microphone
          </Button>
        </>
      )}
    </div>
  );
}
