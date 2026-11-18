"use client";

import { useEffect, useState } from "react";

import { PaperAllocationManager } from "@/components/PaperAllocationManager";
import { Alert, Badge, Button, Card, Field, Modal, PageHeader, Tabs, Textarea, cx } from "@/components/ui";
import { api, apiBlobUrl, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Question, SimilarQuestion } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { validateField } from "@/lib/validation";

type ReviewerView = "queue" | "paper_review";

export default function ReviewQueuePage() {
  const [view, setView] = useState<ReviewerView>("queue");
  const queue = useApi<Question[]>("/reviews/queue");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const items = queue.data ?? [];
  const selected = items.find((q) => q.id === selectedId) ?? items[0] ?? null;

  function finished(text: string) {
    setDone(text);
    setSelectedId(null);
    void queue.reload();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reviewer Quality Governance & Paper Verification"
        subtitle="Verify question accuracy, enforce 100-mark paper allocation criteria, check duplicate similarities, and approve items into the vault."
      />

      <Tabs<ReviewerView>
        value={view}
        onChange={setView}
        tabs={[
          { id: "queue", label: `Question Review Queue (${items.length})` },
          { id: "paper_review", label: "100-Mark Examination Paper Verification" },
        ]}
      />

      {view === "paper_review" ? (
        <PaperAllocationManager isReviewer={true} />
      ) : (
        <>
          {queue.error && <Alert kind="error">{queue.error}</Alert>}
          {done && (
            <div className="mb-4">
              <Alert kind="success">{done}</Alert>
            </div>
          )}
          {!queue.loading && items.length === 0 ? (
            <Card className="p-8 text-center bg-[#071126]/90 border-cyan-500/20">
              <span className="text-3xl block mb-2">🎉</span>
              <p className="text-base font-semibold text-white">Review Queue is Clear</p>
              <p className="mt-1 text-sm text-slate-400">
                All submitted questions have been reviewed and sealed into the vault.
              </p>
            </Card>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Pending Submissions ({items.length})
                </div>
                {items.map((q) => (
                  <button
                    key={q.id}
                    onClick={() => {
                      setSelectedId(q.id);
                      setDone(null);
                    }}
                    className={cx(
                      "block w-full rounded-xl border px-4 py-3 text-left text-sm transition",
                      selected?.id === q.id
                        ? "border-cyan-400/80 bg-cyan-500/15 shadow-md"
                        : "border-slate-800 bg-[#071126]/60 hover:border-slate-700 hover:bg-white/[0.03]",
                    )}
                  >
                    <div className="line-clamp-2 font-medium text-slate-100">{q.stem}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                      <span>
                        {q.subject} · {q.topic}
                      </span>
                      <Badge value={q.difficulty} />
                    </div>
                  </button>
                ))}
              </div>
              {selected && <ReviewPanel key={selected.id} question={selected} onDone={finished} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ReviewPanel({ question: q, onDone }: { question: Question; onDone: (msg: string) => void }) {
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const similar = useApi<SimilarQuestion[]>(`/reviews/${q.id}/similar`);

  useEffect(() => {
    if (!q.has_image) return;
    let url: string | null = null;
    void apiBlobUrl(`/questions/${q.id}/image`).then((u) => {
      url = u;
      setImageUrl(u);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [q.id, q.has_image]);

  async function decide(kind: "approve" | "reject") {
    const check = validateField(kind === "reject" ? "rejection_reason" : "review_note", feedback, kind === "reject");
    if (!check.isValid) {
      setFeedbackError(check.error);
      return;
    }
    setFeedbackError(null);
    setBusy(kind);
    setError(null);
    try {
      await api(`/reviews/${q.id}/${kind}`, {
        method: "POST",
        json: kind === "reject" ? { feedback } : { feedback: feedback.trim() || null },
      });
      setConfirmApproveOpen(false);
      onDone(
        kind === "approve"
          ? `Question #${q.id} approved and cryptographically sealed into the vault.`
          : `Question #${q.id} returned to author with revision feedback.`,
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
      setConfirmApproveOpen(false);
    }
  }

  const topMatch = similar.data?.[0];

  return (
    <div className="space-y-6">
      <Card className="p-6 bg-[#071126]/90 border-cyan-500/20">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3 text-sm text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold text-cyan-300">Question #{q.id}</span>
            <span>·</span>
            <span>{q.subject}</span>
            <span>·</span>
            <span>{q.topic}</span>
            <Badge value={q.difficulty} />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold text-emerald-300">+{q.marks} Marks</span>
            <span>·</span>
            <span>Submitted {fmtDateTime(q.updated_at)}</span>
          </div>
        </div>

        <p className="mt-4 whitespace-pre-wrap text-lg leading-relaxed text-slate-100">{q.stem}</p>

        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="Question diagram"
            className="mt-4 max-h-72 rounded-lg border border-slate-700 bg-black/40"
          />
        )}

        {q.options && q.options.length > 0 && (
          <ol className="mt-5 space-y-2">
            {q.options.map((o, i) => (
              <li
                key={i}
                className={cx(
                  "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm",
                  i === q.correct_option
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-100 font-medium"
                    : "border-slate-800 text-slate-300 bg-white/[0.01]",
                )}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-slate-300">
                  {String.fromCharCode(65 + i)}
                </span>
                <span className="flex-1">{o}</span>
                {i === q.correct_option && (
                  <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs font-semibold text-emerald-300 border border-emerald-500/30">
                    Correct Answer
                  </span>
                )}
              </li>
            ))}
          </ol>
        )}

        {q.explanation && (
          <div className="mt-4 rounded-xl bg-white/[0.03] p-4 text-sm text-slate-300 border border-slate-800">
            <div className="mb-1 text-xs uppercase font-semibold tracking-wider text-slate-400">
              Author&apos;s Solution Rationale
            </div>
            <p className="text-slate-300">{q.explanation}</p>
          </div>
        )}
      </Card>

      {/* Duplicate Analysis Card */}
      <Card className="p-6 bg-[#071126]/90 border-cyan-500/20">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
          Duplicate Detection Engine (TF-IDF Similarity)
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Automatically compares submitted stem against approved questions inside the vault.
        </p>

        {similar.loading ? (
          <p className="mt-3 text-xs text-cyan-300">Running vector comparison…</p>
        ) : similar.error ? (
          <p className="mt-3 text-xs text-rose-300">{similar.error}</p>
        ) : !topMatch ? (
          <p className="mt-3 text-xs text-slate-400">✓ No conflicting questions found in this topic.</p>
        ) : (
          <>
            {topMatch.similarity >= 0.85 && (
              <div className="mt-3">
                <Alert kind="warning">
                  ⚠️ Potential Duplicate: Matches approved Question #{topMatch.question_id} with{" "}
                  <strong>{Math.round(topMatch.similarity * 100)}%</strong> similarity.
                </Alert>
              </div>
            )}
            <ul className="mt-3 space-y-2">
              {similar.data!.map((s) => (
                <li key={s.question_id} className="flex items-center gap-3 text-xs text-slate-300">
                  <span className="w-16 font-mono font-medium text-slate-400">#{s.question_id}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={cx(
                        "h-full",
                        s.similarity >= 0.85
                          ? "bg-rose-400"
                          : s.similarity >= 0.5
                            ? "bg-amber-400"
                            : "bg-cyan-400",
                      )}
                      style={{ width: `${Math.round(s.similarity * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 text-right tabular-nums font-semibold">{Math.round(s.similarity * 100)}%</span>
                  <span className="w-40 truncate text-slate-500">
                    {s.topic} · {s.difficulty}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {/* Reviewer Decision Form */}
      <Card className="p-6 bg-[#071126]/90 border-cyan-500/20">
        <Field
          label="Reviewer Feedback / Revision Notes"
          hint="Mandatory if rejecting. Optional endorsement when approving."
          error={feedbackError}
        >
          <Textarea
            rows={3}
            placeholder="Explain required adjustments or approval notes…"
            maxLength={500}
            value={feedback}
            onChange={(e) => {
              setFeedback(e.target.value);
              if (feedbackError) setFeedbackError(null);
            }}
          />
        </Field>

        {error && (
          <div className="mt-3">
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
          <Button
            variant="danger"
            onClick={() => decide("reject")}
            busy={busy === "reject"}
            disabled={busy !== null}
          >
            Reject with Feedback
          </Button>

          <Button
            variant="primary"
            onClick={() => setConfirmApproveOpen(true)}
            busy={busy === "approve"}
            disabled={busy !== null}
            className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold"
          >
            Approve &amp; Seal in Vault
          </Button>
        </div>
      </Card>

      {/* Approve Confirmation Modal */}
      <Modal
        open={confirmApproveOpen}
        onClose={() => setConfirmApproveOpen(false)}
        title="Confirm Vault Approval"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-300">
            Approving Question <strong>#{q.id}</strong> will immediately encrypt its content using the AEGIS Vault RSA-3072 master key and erase plaintext from operational tables.
          </p>
          <p className="text-xs text-slate-400">
            Once approved, it cannot be modified or read in plaintext until released in an active examination paper.
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
            <Button variant="ghost" onClick={() => setConfirmApproveOpen(false)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => decide("approve")}
              busy={busy === "approve"}
              className="bg-emerald-500 hover:bg-emerald-400 font-semibold text-slate-950"
            >
              Confirm Approval
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
