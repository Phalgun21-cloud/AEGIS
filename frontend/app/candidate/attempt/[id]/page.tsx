"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button, Card, Loading, cx } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtDuration, fmtTime, parseUtc } from "@/lib/format";
import type { Attempt, Receipt, SaveAck } from "@/lib/types";

const SAVE_DEBOUNCE_MS = 700;
const RETRY_MS = 5000;
const HEARTBEAT_MS = 5 * 60 * 1000; // well inside half the 30-minute session lifetime

type SaveState = "idle" | "saving" | "saved" | "error";

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = useRef<Record<string, number | null>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deadlineMs = useRef(0); // deadline in *local* clock terms, corrected for server skew
  const finished = useRef(false);

  const load = useCallback(async () => {
    try {
      const a = await api<Attempt>(`/candidate/attempts/${id}`);
      setAttempt(a);
      setAnswers(a.answers);
      deadlineMs.current = Date.now() + a.remaining_seconds * 1000;
      setRemaining(a.remaining_seconds);
      if (a.submitted_at) finished.current = true;
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    if (finished.current) return;
    finished.current = true;
    setSubmitting(true);
    clearTimeout(saveTimer.current);
    try {
      // Flush unsaved answers first; ignore failure if time is already up.
      if (Object.keys(pending.current).length) {
        await api(`/candidate/attempts/${id}/answers`, { method: "PUT", json: { answers: pending.current } }).catch(() => {});
        pending.current = {};
      }
      setReceipt(await api<Receipt>(`/candidate/attempts/${id}/submit`, { method: "POST" }));
    } catch (e) {
      finished.current = false;
      setError(errorMessage(e));
    } finally {
      setSubmitting(false);
      setConfirming(false);
    }
  }, [id]);

  const flush = useCallback(async () => {
    const batch = pending.current;
    if (!Object.keys(batch).length || finished.current) return;
    pending.current = {};
    setSaveState("saving");
    try {
      const ack = await api<SaveAck>(`/candidate/attempts/${id}/answers`, { method: "PUT", json: { answers: batch } });
      setSavedAt(ack.saved_at);
      setSaveState(Object.keys(pending.current).length ? "saving" : "saved");
      deadlineMs.current = Date.now() + ack.remaining_seconds * 1000; // re-sync timer
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Time is up or already submitted: the server has finalised the attempt.
        finished.current = false;
        void submit();
        return;
      }
      pending.current = { ...batch, ...pending.current };
      setSaveState("error");
      // Retries itself later; by the time the timer fires, `flush` is defined.
      // eslint-disable-next-line react-hooks/immutability
      saveTimer.current = setTimeout(() => void flush(), RETRY_MS);
    }
  }, [id, submit]);

  function choose(questionId: number, option: number | null) {
    if (finished.current) return;
    const key = String(questionId);
    setAnswers((prev) => {
      const next = { ...prev };
      if (option === null) delete next[key];
      else next[key] = option;
      return next;
    });
    pending.current[key] = option;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  // Countdown; auto-submit at zero (the server would also auto-submit at the deadline).
  useEffect(() => {
    if (!attempt || attempt.submitted_at) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((deadlineMs.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) void submit();
    }, 500);
    return () => clearInterval(t);
  }, [attempt, submit]);

  // Keep-alive: keeps the sign-in session renewed while the candidate reads without answering,
  // and re-syncs the timer with the server clock.
  useEffect(() => {
    if (!attempt || attempt.submitted_at) return;
    const t = setInterval(() => {
      if (finished.current) return;
      api<Attempt>(`/candidate/attempts/${id}`)
        .then((a) => {
          deadlineMs.current = Date.now() + a.remaining_seconds * 1000;
        })
        .catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(t);
  }, [attempt, id]);

  // Warn before leaving with unsaved answers.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length && !finished.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  if (error && !attempt) return <Alert>{error}</Alert>;
  if (!attempt) return <Loading label="Loading your exam…" />;

  if (receipt || attempt.submitted_at) {
    return <ReceiptView attempt={attempt} receipt={receipt} />;
  }

  const qs = attempt.questions;
  const q = qs[current];
  const answered = qs.filter((x) => answers[String(x.question_id)] !== undefined).length;
  const low = remaining <= 300;

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-4 border-b border-cyan-500/10 bg-[#050b1a]/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-white">{attempt.title}</div>
          <div className="text-xs text-slate-500">
            {answered} of {qs.length} answered ·{" "}
            {saveState === "saving" && <span className="text-cyan-300">Saving…</span>}
            {saveState === "saved" && <span className="text-emerald-300">All answers saved {fmtTime(savedAt)}</span>}
            {saveState === "error" && <span className="text-amber-300">Not saved. Retrying…</span>}
            {saveState === "idle" && <span>Answers save automatically</span>}
          </div>
        </div>
        <div
          className={cx("font-mono text-2xl tabular-nums", low ? "text-rose-300" : "text-cyan-200")}
          role="timer"
          aria-label="Time remaining"
        >
          {fmtDuration(remaining)}
        </div>
        <Button onClick={() => setConfirming(true)} disabled={submitting}>
          Submit
        </Button>
      </div>

      {error && <Alert>{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_14rem]">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between text-sm text-slate-400">
            <span>
              Question {q.number} of {qs.length}
            </span>
            <span>
              {q.marks} mark{q.marks === 1 ? "" : "s"}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-white">{q.stem}</p>
          {q.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`data:${q.image.mime};base64,${q.image.data}`}
              alt={`Diagram for question ${q.number}`}
              className="mt-4 max-h-80 rounded-lg border border-slate-700"
            />
          )}
          <fieldset className="mt-6 space-y-2">
            <legend className="sr-only">Options</legend>
            {q.options.map((o, i) => {
              const chosen = answers[String(q.question_id)] === i;
              return (
                <label
                  key={i}
                  className={cx(
                    "flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition",
                    chosen ? "border-cyan-400 bg-cyan-500/10" : "border-slate-800 hover:border-slate-600",
                  )}
                >
                  <input
                    type="radio"
                    name={`q-${q.question_id}`}
                    checked={chosen}
                    onChange={() => choose(q.question_id, i)}
                    className="mt-1 accent-cyan-400"
                  />
                  <span className="font-medium text-slate-400">{String.fromCharCode(65 + i)}.</span>
                  <span className="flex-1 text-slate-100">{o}</span>
                </label>
              );
            })}
          </fieldset>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button variant="secondary" disabled={current === 0} onClick={() => setCurrent(current - 1)}>
              ← Previous
            </Button>
            <Button variant="secondary" disabled={current === qs.length - 1} onClick={() => setCurrent(current + 1)}>
              Next →
            </Button>
            {answers[String(q.question_id)] !== undefined && (
              <button className="ml-auto text-sm text-slate-500 hover:text-slate-300" onClick={() => choose(q.question_id, null)}>
                Clear answer
              </button>
            )}
          </div>
        </Card>

        <Card className="h-fit">
          <div className="mb-3 text-xs uppercase tracking-wider text-slate-400">Questions</div>
          <div className="grid grid-cols-5 gap-2">
            {qs.map((x, i) => {
              const done = answers[String(x.question_id)] !== undefined;
              return (
                <button
                  key={x.question_id}
                  onClick={() => setCurrent(i)}
                  aria-label={`Question ${x.number}${done ? ", answered" : ""}`}
                  className={cx(
                    "h-9 rounded-md text-sm tabular-nums transition",
                    i === current && "ring-2 ring-cyan-400",
                    done ? "bg-cyan-500/25 text-cyan-100" : "bg-slate-800 text-slate-400 hover:bg-slate-700",
                  )}
                >
                  {x.number}
                </button>
              );
            })}
          </div>
          <div className="mt-4 space-y-1 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-cyan-500/25" /> Answered
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-slate-800" /> Not answered
            </div>
          </div>
        </Card>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-md bg-[#08122a]">
            <h2 className="text-lg font-medium text-white">Submit your exam?</h2>
            <p className="mt-2 text-sm text-slate-300">
              You have answered {answered} of {qs.length} questions.
              {answered < qs.length && (
                <span className="text-amber-300"> {qs.length - answered} unanswered.</span>
              )}
            </p>
            <p className="mt-2 text-sm text-slate-400">After submitting you can&apos;t change any answers.</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
                Keep working
              </Button>
              <Button onClick={submit} busy={submitting}>
                Submit now
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function ReceiptView({ attempt, receipt }: { attempt: Attempt; receipt: Receipt | null }) {
  const submittedAt = receipt?.submitted_at ?? attempt.submitted_at;
  const [fetched, setFetched] = useState<Receipt | null>(receipt);

  // Opening a finished attempt later: re-request the (idempotent) receipt.
  useEffect(() => {
    if (fetched) return;
    api<Receipt>(`/candidate/attempts/${attempt.attempt_id}/submit`, { method: "POST" })
      .then(setFetched)
      .catch(() => {});
  }, [attempt.attempt_id, fetched]);

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card className="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-2xl text-emerald-300">
          ✓
        </div>
        <h1 className="mt-4 text-xl font-semibold text-white">Exam submitted</h1>
        <p className="mt-1 text-sm text-slate-400">{attempt.title}</p>
        {fetched?.auto_submitted && (
          <p className="mt-3 text-sm text-amber-300">Time ran out, so your saved answers were submitted automatically.</p>
        )}
        <dl className="mt-6 space-y-2 text-left text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Submitted</dt>
            <dd>{submittedAt ? fmtDateTime(submittedAt) : "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Attempt</dt>
            <dd>#{attempt.attempt_id}</dd>
          </div>
        </dl>
        {fetched && (
          <div className="mt-4 rounded-lg bg-white/[0.03] p-3 text-left">
            <div className="text-xs uppercase tracking-wider text-slate-500">Submission receipt (SHA-256)</div>
            <code className="mt-1 block break-all font-mono text-xs text-cyan-200">{fetched.answers_sha256}</code>
            <p className="mt-2 text-xs text-slate-500">
              Keep this code. It identifies exactly the answers that were recorded
              {submittedAt ? ` at ${parseUtc(submittedAt).toLocaleTimeString()}` : ""}.
            </p>
          </div>
        )}
        <Link href="/candidate" className="mt-6 inline-block">
          <Button variant="secondary">Back to my exams</Button>
        </Link>
      </Card>
    </div>
  );
}
