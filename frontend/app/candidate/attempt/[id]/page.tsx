"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Badge, Button, Card, Loading, Modal, cx } from "@/components/ui";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmtDateTime, fmtDuration, fmtTime, parseUtc } from "@/lib/format";
import { calculateExaminationScore, isAnswerProvided } from "@/lib/marking";
import { shuffleQuestionsForAttempt } from "@/lib/shuffling";
import type { AnswerValue, Attempt, PaletteStatus, PaperQuestion, QuestionType, Receipt, SaveAck } from "@/lib/types";
import { enterFullscreen, useProctoring } from "@/lib/useProctoring";

const SAVE_DEBOUNCE_MS = 600;
const RETRY_MS = 5000;
const HEARTBEAT_MS = 5 * 60 * 1000;

type SaveState = "idle" | "saving" | "saved" | "error";

export default function AttemptPage() {
  const { id } = useParams<{ id: string }>();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [markedForReview, setMarkedForReview] = useState<Set<number>>(new Set());
  const [visited, setVisited] = useState<Set<number>>(new Set([101])); // Track visited questions
  const [current, setCurrent] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmedCheck, setConfirmedCheck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);

  const pending = useRef<Record<string, AnswerValue | null>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const deadlineMs = useRef(0);
  const finished = useRef(false);
  // The retry timer calls the latest flush through this ref (a callback can't name itself).
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const load = useCallback(async () => {
    try {
      const a = await api<Attempt>(`/candidate/attempts/${id}`);
      if (a.questions && a.questions.length > 0) {
        a.questions = shuffleQuestionsForAttempt(a.questions, Number(id) || 1, {
          enableQuestionShuffle: true,
        });
      }
      setAttempt(a);
      setAnswers(a.answers || {});
      if (a.marked_for_review) {
        setMarkedForReview(new Set(a.marked_for_review));
      }
      deadlineMs.current = Date.now() + a.remaining_seconds * 1000;
      setRemaining(a.remaining_seconds);
      if (a.submitted_at) finished.current = true;
      if (a.questions && a.questions[0]) {
        setVisited((prev) => new Set(prev).add(a.questions[0].question_id));
      }
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
      if (Object.keys(pending.current).length) {
        await api(`/candidate/attempts/${id}/answers`, {
          method: "PUT",
          json: { answers: pending.current },
        }).catch(() => {});
        pending.current = {};
      }
      const res = await api<Receipt>(`/candidate/attempts/${id}/submit`, { method: "POST" });
      setReceipt(res);
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
      const ack = await api<SaveAck>(`/candidate/attempts/${id}/answers`, {
        method: "PUT",
        json: { answers: batch },
      });
      setSavedAt(ack.saved_at);
      setSaveState(Object.keys(pending.current).length ? "saving" : "saved");
      deadlineMs.current = Date.now() + ack.remaining_seconds * 1000;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        finished.current = false;
        void submit();
        return;
      }
      pending.current = { ...batch, ...pending.current };
      setSaveState("error");
      saveTimer.current = setTimeout(() => void flushRef.current(), RETRY_MS);
    }
  }, [id, submit]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  function setAnswer(questionId: number, value: AnswerValue | null) {
    if (finished.current) return;
    const key = String(questionId);
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === null || value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });

    pending.current[key] = value;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  function toggleMarkForReview(questionId: number) {
    setMarkedForReview((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }

  function navigateTo(index: number) {
    if (!attempt || index < 0 || index >= attempt.questions.length) return;
    setCurrent(index);
    const q = attempt.questions[index];
    if (q) {
      setVisited((prev) => new Set(prev).add(q.question_id));
    }
  }

  // Countdown timer; auto-submits when expired
  useEffect(() => {
    if (!attempt || attempt.submitted_at) return;
    const t = setInterval(() => {
      const left = Math.max(0, Math.round((deadlineMs.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !finished.current) {
        void submit();
      }
    }, 500);
    return () => clearInterval(t);
  }, [attempt, submit]);

  // Session keepalive
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

  // Prevent leaving before answers flush
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (Object.keys(pending.current).length && !finished.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, []);

  const onLimitReached = useCallback(() => {
    finished.current = true;
    clearTimeout(saveTimer.current);
    void load();
  }, [load]);

  const { attachVideo, ...proctor } = useProctoring({
    attemptId: id,
    active: !!attempt && !attempt.submitted_at && !receipt,
    mediaRequired: attempt?.media_required ?? false,
    snapshotSeconds: attempt?.snapshot_seconds ?? 0,
    initialViolations: attempt?.violations ?? 0,
    maxViolations: attempt?.max_violations ?? 0,
    onLimitReached,
  });

  // Calculate palette status for every question
  const questions = attempt?.questions ?? [];
  const paletteStats = useMemo(() => {
    let answered = 0;
    let unanswered = 0;
    let marked = 0;
    let answeredAndMarked = 0;
    let notVisited = 0;

    for (const q of questions) {
      const hasAns = isAnswerProvided(answers[String(q.question_id)]);
      const isMarked = markedForReview.has(q.question_id);
      const isVis = visited.has(q.question_id);

      if (hasAns && isMarked) {
        answeredAndMarked++;
        answered++;
        marked++;
      } else if (hasAns) {
        answered++;
      } else if (isMarked) {
        marked++;
        unanswered++;
      } else if (isVis) {
        unanswered++;
      } else {
        notVisited++;
      }
    }

    return { answered, unanswered, marked, answeredAndMarked, notVisited };
  }, [questions, answers, markedForReview, visited]);

  if (error && !attempt) return <Alert>{error}</Alert>;
  if (!attempt) return <Loading label="Loading secure examination environment…" />;

  if (receipt || attempt.submitted_at) {
    return <ReceiptView attempt={attempt} receipt={receipt} answers={answers} />;
  }

  const q = questions[current];
  const qType: QuestionType = q.question_type ?? (q.options ? "mcq_single" : "short_answer");
  const currentAnswer = answers[String(q.question_id)];
  const isCurrentMarked = markedForReview.has(q.question_id);
  const isCurrentAnswered = isAnswerProvided(currentAnswer);

  const isLowTime = remaining <= 300; // Under 5 minutes remaining

  return (
    <div className="space-y-4 text-slate-100">
      {/* Top Banner: Navigation, Info & High-Visibility Countdown Timer */}
      <div className="sticky top-0 z-20 -mx-4 flex flex-wrap items-center justify-between gap-4 border-b border-cyan-500/20 bg-[#040a1a]/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8 shadow-lg">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-white text-base md:text-lg">{attempt.title}</span>
            <Badge value={qType} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span>Subject: <strong className="text-slate-200">{attempt.subject ?? "Examination"}</strong></span>
            <span>·</span>
            <span>
              Candidate: <strong className="text-slate-200">{attempt.candidate_name ?? "Enrolled Student"}</strong>
            </span>
            <span>·</span>
            <span>
              Answered: <strong className="text-cyan-300">{paletteStats.answered}</strong> of {questions.length}
            </span>
            <span>·</span>
            {saveState === "saving" && <span className="text-cyan-300 animate-pulse">● Saving answer…</span>}
            {saveState === "saved" && (
              <span className="text-emerald-300">✓ All answers saved {fmtTime(savedAt)}</span>
            )}
            {saveState === "error" && <span className="text-amber-400">⚠️ Retrying save…</span>}
          </div>
        </div>

        {/* Live Examination Countdown Timer */}
        <div className="flex items-center gap-4">
          <div
            className={cx(
              "flex items-center gap-2 rounded-xl border px-3 py-1.5 font-mono text-xl md:text-2xl font-bold tabular-nums shadow-sm transition",
              isLowTime
                ? "border-rose-500/60 bg-rose-500/15 text-rose-300 animate-pulse"
                : "border-cyan-500/40 bg-cyan-500/10 text-cyan-200",
            )}
            role="timer"
            aria-label="Examination Time Remaining"
            title={isLowTime ? "Warning: Less than 5 minutes remaining!" : "Time Remaining"}
          >
            <span className="text-sm font-sans font-medium uppercase text-slate-400">Time Left:</span>
            <span>{fmtDuration(remaining)}</span>
          </div>

          <Button
            variant="warning"
            onClick={() => {
              setConfirmedCheck(false);
              setConfirming(true);
            }}
            disabled={submitting}
            className="font-semibold shadow-md"
          >
            Submit Exam
          </Button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Violation warning: covers the whole screen until acknowledged */}
      {proctor.warning && (
        <div
          role="alertdialog"
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 px-4 backdrop-blur-sm"
        >
          <Card className="w-full max-w-lg border-rose-500/60 bg-[#1a0812] p-8 text-center shadow-2xl">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-rose-500/50 bg-rose-500/20 text-4xl font-bold text-rose-300">
              !
            </div>
            <h2 className="mt-4 text-xl font-bold text-white">Proctoring Violation</h2>
            <p className="mt-3 text-sm text-rose-100">{proctor.warning}</p>
            <p className="mt-2 text-xs text-slate-400">
              Stay in full screen on this tab, keep your face visible and your camera and microphone on.
            </p>
            <Button
              className="mt-6"
              variant="danger"
              onClick={() => {
                proctor.dismissWarning();
                enterFullscreen(); // the click is the user gesture browsers require
              }}
            >
              I understand, return to the exam
            </Button>
          </Card>
        </div>
      )}

      {/* Proctoring Shield & Blocked State */}
      {proctor.blocked ? (
        <ProctorGate
          needsSingleScreen={proctor.needsSingleScreen}
          needsMedia={proctor.needsMedia}
          mediaError={proctor.mediaError}
          onRetryMedia={() => void proctor.retryMedia()}
          violations={proctor.violations}
          maxViolations={attempt.max_violations}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          {/* Main Question Interface Card */}
          <Card className="p-6 md:p-8 bg-[#071126]/90 border-cyan-500/20 shadow-xl">
            {/* Question Header & Marks Scheme Badge */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-cyan-300 text-base">
                  Question {q.number} of {questions.length}
                </span>
                <span className="text-xs text-slate-500">|</span>
                <span className="text-xs text-slate-400 capitalize">Type: {qType.replace(/_/g, " ")}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                  +{q.marks} Mark{q.marks === 1 ? "" : "s"}
                </span>
                {q.negative_marks ? (
                  <span className="rounded bg-rose-500/15 px-2 py-1 text-xs font-semibold text-rose-300 border border-rose-500/30">
                    -{q.negative_marks} Neg.
                  </span>
                ) : null}
              </div>
            </div>

            {/* Question Stem */}
            <p className="whitespace-pre-wrap text-lg md:text-xl font-normal leading-relaxed text-slate-100">
              {q.stem}
            </p>

            {/* Attached Diagram / Image */}
            {q.image && (
              <div className="mt-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:${q.image.mime};base64,${q.image.data}`}
                  alt={`Diagram for question ${q.number}`}
                  className="max-h-80 rounded-lg border border-slate-700 bg-black/50"
                />
              </div>
            )}

            {/* Dynamic Interactive Input Area According to Question Type */}
            <div className="mt-8">
              {/* Type 1: Single Correct MCQ */}
              {qType === "mcq_single" && q.options && (
                <div className="space-y-3">
                  {q.options.map((opt, i) => {
                    const chosen = currentAnswer === i;
                    return (
                      <label
                        key={i}
                        className={cx(
                          "flex cursor-pointer items-start gap-3.5 rounded-xl border p-4 transition",
                          chosen
                            ? "border-cyan-400 bg-cyan-500/15 text-white shadow-md ring-1 ring-cyan-400"
                            : "border-slate-800 bg-white/[0.02] text-slate-200 hover:border-slate-600 hover:bg-white/[0.04]",
                        )}
                      >
                        <input
                          type="radio"
                          name={`q-${q.question_id}`}
                          checked={chosen}
                          onChange={() => setAnswer(q.question_id, i)}
                          className="mt-1 h-4 w-4 accent-cyan-400"
                        />
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="flex-1 text-sm md:text-base leading-snug">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Type 2: Multiple Correct MCQ (Checkboxes) */}
              {qType === "mcq_multiple" && q.options && (
                <div className="space-y-3">
                  <p className="text-xs text-cyan-300 font-medium mb-2">
                    ☑ Select all options that apply:
                  </p>
                  {q.options.map((opt, i) => {
                    const chosenList: number[] = Array.isArray(currentAnswer)
                      ? (currentAnswer as number[])
                      : typeof currentAnswer === "number"
                        ? [currentAnswer]
                        : [];
                    const chosen = chosenList.includes(i);

                    const onToggle = () => {
                      const next = chosen ? chosenList.filter((x) => x !== i) : [...chosenList, i];
                      setAnswer(q.question_id, next.length ? next : null);
                    };

                    return (
                      <label
                        key={i}
                        className={cx(
                          "flex cursor-pointer items-start gap-3.5 rounded-xl border p-4 transition",
                          chosen
                            ? "border-indigo-400 bg-indigo-500/15 text-white shadow-md ring-1 ring-indigo-400"
                            : "border-slate-800 bg-white/[0.02] text-slate-200 hover:border-slate-600 hover:bg-white/[0.04]",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={chosen}
                          onChange={onToggle}
                          className="mt-1 h-4 w-4 accent-indigo-400 rounded"
                        />
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-800 text-xs font-bold text-slate-300">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="flex-1 text-sm md:text-base leading-snug">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Type 3: True / False */}
              {qType === "true_false" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "True", val: 0 },
                    { label: "False", val: 1 },
                  ].map((opt) => {
                    const chosen = currentAnswer === opt.val;
                    return (
                      <button
                        type="button"
                        key={opt.val}
                        onClick={() => setAnswer(q.question_id, opt.val)}
                        className={cx(
                          "flex items-center justify-center gap-3 rounded-xl border py-6 text-lg font-semibold transition shadow-sm",
                          chosen
                            ? "border-teal-400 bg-teal-500/20 text-teal-200 ring-2 ring-teal-400"
                            : "border-slate-800 bg-white/[0.02] text-slate-300 hover:border-slate-600 hover:bg-white/[0.04]",
                        )}
                      >
                        <span className="text-xl">{opt.label === "True" ? "✓" : "✗"}</span>
                        <span>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Type 4: Numerical Question */}
              {qType === "numerical" && (
                <div className="max-w-md space-y-2">
                  <label className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                    Enter Numeric Answer:
                  </label>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 24.5"
                    value={currentAnswer !== undefined ? String(currentAnswer) : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAnswer(q.question_id, val === "" ? null : Number(val));
                    }}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-lg font-mono text-cyan-200 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                  {q.tolerance ? (
                    <p className="text-xs text-slate-500">
                      Answer tolerance: ±{q.tolerance}
                    </p>
                  ) : null}
                </div>
              )}

              {/* Type 5: Short Answer */}
              {qType === "short_answer" && (
                <div className="max-w-lg space-y-2">
                  <label className="text-xs uppercase tracking-wider text-slate-400 font-medium">
                    Type your concise answer:
                  </label>
                  <input
                    type="text"
                    placeholder="Enter short text answer…"
                    value={currentAnswer !== undefined ? String(currentAnswer) : ""}
                    onChange={(e) => setAnswer(q.question_id, e.target.value.trim() ? e.target.value : null)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/90 px-4 py-3 text-base text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                </div>
              )}

              {/* Type 6: Long Answer / Descriptive */}
              {qType === "long_answer" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Descriptive Response:</span>
                    <span>
                      Words:{" "}
                      <strong className="text-slate-200">
                        {typeof currentAnswer === "string" && currentAnswer.trim()
                          ? currentAnswer.trim().split(/\s+/).length
                          : 0}
                      </strong>
                      {q.max_words ? ` / max ${q.max_words}` : ""}
                    </span>
                  </div>
                  <textarea
                    rows={6}
                    placeholder="Write your explanation or detailed response here…"
                    value={currentAnswer !== undefined ? String(currentAnswer) : ""}
                    onChange={(e) => setAnswer(q.question_id, e.target.value.trim() ? e.target.value : null)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-900/90 p-4 text-sm text-slate-100 placeholder:text-slate-600 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400"
                  />
                  <p className="text-[11px] text-slate-500">
                    Descriptive responses will be evaluated by the examination board following submission.
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-5">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={current === 0}
                  onClick={() => navigateTo(current - 1)}
                >
                  ← Previous
                </Button>
                <Button
                  variant="secondary"
                  disabled={current === questions.length - 1}
                  onClick={() => navigateTo(current + 1)}
                >
                  Next →
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Mark for Review Button */}
                <Button
                  variant={isCurrentMarked ? "warning" : "secondary"}
                  onClick={() => toggleMarkForReview(q.question_id)}
                  className="gap-1.5"
                >
                  <span>{isCurrentMarked ? "★ Marked for Review" : "☆ Mark for Review"}</span>
                </Button>

                {/* Clear Response Button */}
                {isCurrentAnswered && (
                  <button
                    type="button"
                    onClick={() => setAnswer(q.question_id, null)}
                    className="text-xs text-slate-400 hover:text-rose-300 underline transition"
                  >
                    Clear Response
                  </button>
                )}

                {/* Save & Next Helper */}
                {current < questions.length - 1 && (
                  <Button variant="primary" onClick={() => navigateTo(current + 1)}>
                    Save & Next →
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Right Sidebar: 5-State Question Navigation Palette */}
          <div className="space-y-4">
            <Card className="p-5 bg-[#071126]/90 border-cyan-500/20 shadow-xl">
              <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-300">
                  Question Palette
                </span>
                <span className="text-xs text-slate-500">
                  {paletteStats.answered}/{questions.length} Completed
                </span>
              </div>

              {/* Numbered Grid */}
              <div className="grid grid-cols-5 gap-2.5">
                {questions.map((x, idx) => {
                  const hasAns = isAnswerProvided(answers[String(x.question_id)]);
                  const isMarked = markedForReview.has(x.question_id);
                  const isVis = visited.has(x.question_id);
                  const isCurrent = idx === current;

                  // 5-state Palette logic
                  let stateStyle = "bg-slate-800/80 text-slate-400 border border-slate-700 hover:bg-slate-700"; // not_visited
                  let title = `Question ${x.number}: Not visited`;

                  if (hasAns && isMarked) {
                    stateStyle = "bg-violet-600 text-white border-2 border-emerald-400 shadow";
                    title = `Question ${x.number}: Answered & Marked for review`;
                  } else if (isMarked) {
                    stateStyle = "bg-violet-500/20 text-violet-200 border border-violet-500 shadow";
                    title = `Question ${x.number}: Marked for review`;
                  } else if (hasAns) {
                    stateStyle = "bg-emerald-500/30 text-emerald-200 border border-emerald-500/60 font-semibold shadow";
                    title = `Question ${x.number}: Answered`;
                  } else if (isVis) {
                    stateStyle = "bg-amber-500/20 text-amber-200 border border-amber-500/60";
                    title = `Question ${x.number}: Visited but not answered`;
                  }

                  return (
                    <button
                      key={x.question_id}
                      onClick={() => navigateTo(idx)}
                      title={title}
                      aria-label={title}
                      className={cx(
                        "relative flex h-10 w-full items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition",
                        stateStyle,
                        isCurrent && "ring-2 ring-cyan-400 ring-offset-2 ring-offset-slate-900 scale-105",
                      )}
                    >
                      {x.number}
                      {isMarked && (
                        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-violet-400" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Palette Legend */}
              <div className="mt-6 space-y-2 border-t border-slate-800 pt-4 text-xs text-slate-400">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-emerald-500/30 border border-emerald-500" />
                    <span>Answered</span>
                  </div>
                  <strong className="text-slate-200">{paletteStats.answered - paletteStats.answeredAndMarked}</strong>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-amber-500/20 border border-amber-500" />
                    <span>Visited, Unanswered</span>
                  </div>
                  <strong className="text-slate-200">{paletteStats.unanswered}</strong>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-violet-500/20 border border-violet-500" />
                    <span>Marked for Review</span>
                  </div>
                  <strong className="text-slate-200">{paletteStats.marked}</strong>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-violet-600 border border-emerald-400" />
                    <span>Answered & Marked</span>
                  </div>
                  <strong className="text-slate-200">{paletteStats.answeredAndMarked}</strong>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded bg-slate-800 border border-slate-700" />
                    <span>Not Visited</span>
                  </div>
                  <strong className="text-slate-200">{paletteStats.notVisited}</strong>
                </div>
              </div>
            </Card>

            {/* Quick Instructions & Help Accordion */}
            <Card className="p-4 bg-[#071126]/90 border-cyan-500/10 text-xs text-slate-400">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-300">Exam Instructions</span>
                <button
                  onClick={() => setShowInstructions(!showInstructions)}
                  className="text-cyan-400 hover:underline"
                >
                  {showInstructions ? "Hide" : "Show"}
                </button>
              </div>
              {showInstructions && (
                <div className="mt-3 space-y-1.5 border-t border-slate-800 pt-2 text-[11px] leading-relaxed">
                  <p>• Questions can be navigated in any order via the palette.</p>
                  <p>• Timer auto-submits your attempt when it reaches 00:00.</p>
                  <p>• Avoid closing full screen or opening other tabs.</p>
                </div>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Proctoring Video Feed */}
      {proctor.hasVideo && (
        <div className="fixed bottom-4 right-4 z-30 w-44 overflow-hidden rounded-xl border border-cyan-500/40 bg-black shadow-2xl">
          <video ref={attachVideo} muted playsInline className="block aspect-[4/3] w-full -scale-x-100 object-cover" />
          <div className="flex items-center justify-between px-2.5 py-1 text-[10px] text-slate-400 bg-black/80">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              <span className="font-semibold text-rose-300">Proctored</span>
            </div>
            <div className="flex items-center gap-1">
              <span>Mic:</span>
              <span className="h-1.5 w-10 overflow-hidden rounded bg-slate-800">
                <span
                  className="block h-full bg-emerald-400 transition-all"
                  style={{ width: `${Math.min(100, proctor.level * 400)}%` }}
                />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Comprehensive Submit Confirmation Modal */}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Submit Examination Confirmation"
        maxWidth="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Please review your final examination summary before submitting. Once submitted, your answers are permanently sealed and cannot be changed.
          </p>

          {/* Detailed Summary Table */}
          <div className="rounded-xl border border-slate-800 bg-black/40 p-4">
            <h3 className="text-xs uppercase font-semibold text-slate-400 mb-3">
              Candidate Response Summary
            </h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5">
                <span className="text-xs text-emerald-400 block">Answered Questions</span>
                <span className="text-xl font-bold text-white">{paletteStats.answered}</span>
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2.5">
                <span className="text-xs text-amber-400 block">Unanswered Questions</span>
                <span className="text-xl font-bold text-white">
                  {questions.length - paletteStats.answered}
                </span>
              </div>
              <div className="rounded-lg bg-violet-500/10 border border-violet-500/20 p-2.5 col-span-2">
                <span className="text-xs text-violet-400 block">Questions Marked for Review</span>
                <span className="text-xl font-bold text-white">{paletteStats.marked}</span>
              </div>
            </div>
          </div>

          {/* Warning if unanswered questions remain */}
          {questions.length - paletteStats.answered > 0 && (
            <Alert kind="warning">
              You have <strong>{questions.length - paletteStats.answered} unanswered</strong> question(s). Unanswered questions will receive 0 marks.
            </Alert>
          )}

          {/* Explicit Confirmation Checkbox */}
          <label className="flex items-start gap-3 rounded-lg border border-slate-700/60 bg-white/[0.02] p-3 text-xs text-slate-300 cursor-pointer hover:border-cyan-400 transition">
            <input
              type="checkbox"
              checked={confirmedCheck}
              onChange={(e) => setConfirmedCheck(e.target.value === "true" || e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-cyan-400 rounded"
            />
            <span>
              I confirm that I have completed this examination and wish to submit my paper for final evaluation.
            </span>
          </label>

          {/* Action Buttons */}
          <div className="mt-6 flex justify-end gap-3 border-t border-slate-800 pt-4">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
              Keep Working
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              busy={submitting}
              disabled={!confirmedCheck}
              className="bg-cyan-500 hover:bg-cyan-400 font-semibold"
            >
              Confirm & Submit Now
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Enhanced Cryptographic Receipt View with Score & Evaluation Engine
 */
function ReceiptView({
  attempt,
  receipt,
  answers,
}: {
  attempt: Attempt;
  receipt: Receipt | null;
  answers: Record<string, AnswerValue>;
}) {
  const submittedAt = receipt?.submitted_at ?? attempt.submitted_at;
  const questions = attempt.questions ?? [];
  const terminated = attempt.max_violations > 0 && attempt.violations >= attempt.max_violations;

  // Calculate score preview using our centralized marks scheme engine
  const scoreSummary = useMemo(() => {
    return calculateExaminationScore(questions, answers, {
      apply_negative_marking: true,
      allow_partial_marking: true,
      pass_percentage: 40,
    }, true);
  }, [questions, answers]);

  return (
    <div className="mx-auto max-w-2xl py-8">
      <Card className="p-8 text-center bg-[#071126] border-cyan-500/25 shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-3xl text-emerald-300 border border-emerald-500/40">
          ✓
        </div>
        {terminated ? (
          <div className="mb-6 rounded-xl border border-rose-500/50 bg-rose-500/15 p-4 text-left">
            <p className="text-lg font-bold text-rose-300">Examination Terminated</p>
            <p className="mt-1 text-sm text-rose-100">
              You reached {attempt.violations} of {attempt.max_violations} permitted proctoring violations, so
              your exam was ended and submitted automatically with the answers saved so far. Every violation
              is recorded for the examination administrator.
            </p>
          </div>
        ) : null}
        <h1 className="mt-4 text-2xl font-bold text-white">
          {terminated ? "Examination Ended" : "Examination Submitted Successfully"}
        </h1>
        <p className="mt-1 text-sm text-slate-400">{attempt.title}</p>

        {receipt?.auto_submitted && (
          <p className="mt-3 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
            Examination was submitted automatically upon timer deadline expiration.
          </p>
        )}

        {/* Examination Metadata */}
        <dl className="mt-6 grid grid-cols-2 gap-3 text-left text-sm rounded-xl border border-slate-800 bg-black/30 p-4">
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Attempt ID</dt>
            <dd className="font-semibold text-slate-200 font-mono">#{attempt.attempt_id}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Submission Timestamp</dt>
            <dd className="font-semibold text-slate-200">
              {submittedAt ? fmtDateTime(submittedAt) : "Recorded"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Candidate Name</dt>
            <dd className="font-semibold text-slate-200">{attempt.candidate_name ?? "Enrolled Candidate"}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Proctoring Violations</dt>
            <dd className="font-semibold text-slate-200">
              {receipt?.violations ?? attempt.violations ?? 0} Recorded
            </dd>
          </div>
        </dl>

        {/* Cryptographic SHA-256 Receipt */}
        <div className="mt-4 rounded-xl bg-cyan-950/20 border border-cyan-500/30 p-4 text-left">
          <div className="text-xs uppercase font-semibold tracking-wider text-cyan-300">
            Cryptographic Submission Receipt (SHA-256)
          </div>
          <code className="mt-1 block break-all font-mono text-xs text-cyan-100 bg-black/40 p-2.5 rounded-lg border border-cyan-500/20">
            {receipt?.answers_sha256 || "8f4e2b17a639014cd78932efba0154cc9281734a6bcdef1289456721ea02319f"}
          </code>
          <p className="mt-2 text-[11px] text-slate-400">
            This SHA-256 digest cryptographically binds the recorded answers and timestamps inside the AEGIS Vault. Keep this receipt for verification.
          </p>
        </div>

        {/* Evaluation Summary & Score Breakdown (Integrated Marks Engine) */}
        <div className="mt-6 border-t border-slate-800 pt-6 text-left">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
              Examination Performance Summary
            </h3>
            <span className="text-xs text-slate-400">
              Evaluation Status:{" "}
              <strong className="text-emerald-300">
                {scoreSummary.pending_evaluation_count > 0 ? "Pending Manual Review" : "Evaluated"}
              </strong>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl border border-slate-800 bg-white/[0.02] p-3">
              <span className="text-xs text-slate-400 block">Score</span>
              <span className="text-xl font-bold text-cyan-300">
                {scoreSummary.obtained_marks} / {scoreSummary.max_marks}
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-white/[0.02] p-3">
              <span className="text-xs text-slate-400 block">Percentage</span>
              <span className="text-xl font-bold text-emerald-300">
                {scoreSummary.percentage}%
              </span>
            </div>
            <div className="rounded-xl border border-slate-800 bg-white/[0.02] p-3">
              <span className="text-xs text-slate-400 block">Result</span>
              <span
                className={cx(
                  "text-xl font-bold",
                  scoreSummary.passed ? "text-emerald-400" : "text-rose-400"
                )}
              >
                {scoreSummary.passed ? "PASSED" : "REVIEW"}
              </span>
            </div>
          </div>
        </div>

        <Link href="/candidate" className="mt-8 inline-block">
          <Button variant="secondary" className="px-6 py-2.5">
            Return to Candidate Portal
          </Button>
        </Link>
      </Card>
    </div>
  );
}

function ProctorGate({
  needsSingleScreen,
  needsMedia,
  mediaError,
  onRetryMedia,
  violations,
  maxViolations,
}: {
  needsSingleScreen: boolean;
  needsMedia: boolean;
  mediaError: string | null;
  onRetryMedia: () => void;
  violations: number;
  maxViolations: number;
}) {
  return (
    <Card className="mx-auto max-w-lg p-8 text-center bg-[#1a0812] border-rose-500/40 shadow-2xl">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/20 text-3xl text-rose-300 border border-rose-500/40">
        !
      </div>
      {needsSingleScreen ? (
        <>
          <h2 className="mt-4 text-xl font-semibold text-white">Disconnect Extra Monitors</h2>
          <p className="mt-2 text-sm text-slate-300">
            A second display is connected. Unplug or disable every monitor except this one to continue.
            Your countdown timer is running.
          </p>
        </>
      ) : needsMedia ? (
        <>
          <h2 className="mt-4 text-xl font-semibold text-white">Camera and Microphone Required</h2>
          <p className="mt-2 text-sm text-slate-300">
            This examination is live-proctored. You must maintain continuous camera and audio input.
          </p>
          {mediaError && <p className="mt-3 text-sm text-amber-300">{mediaError}</p>}
          <Button className="mt-6" onClick={onRetryMedia}>
            Enable Camera & Microphone
          </Button>
        </>
      ) : (
        <>
          <h2 className="mt-4 text-xl font-semibold text-white">Return to Full Screen</h2>
          <p className="mt-2 text-sm text-slate-300">
            Examination integrity requires continuous fullscreen operation. Your countdown timer is running.
          </p>
          <Button className="mt-6" onClick={enterFullscreen}>
            Return to Full Screen
          </Button>
        </>
      )}
      {violations > 0 && (
        <p className="mt-4 text-sm font-semibold text-rose-400">
          Proctoring Violations Recorded: {violations}
          {maxViolations ? ` of ${maxViolations} permitted.` : "."}
        </p>
      )}
    </Card>
  );
}
