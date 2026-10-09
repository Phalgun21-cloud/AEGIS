"use client";

import { useEffect, useState } from "react";

import { Alert, Badge, Button, Card, Field, PageHeader, Textarea, cx } from "@/components/ui";
import { api, apiBlobUrl, errorMessage } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import type { Question, SimilarQuestion } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function ReviewQueuePage() {
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
    <>
      <PageHeader
        title="Review Queue"
        subtitle="Check correctness, language, topic and difficulty. Only approved questions enter the vault."
      />
      {queue.error && <Alert>{queue.error}</Alert>}
      {done && (
        <div className="mb-4">
          <Alert kind="success">{done}</Alert>
        </div>
      )}
      {!queue.loading && items.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">Nothing waiting for review. 🎉</p>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
          <div className="space-y-2">
            {items.map((q) => (
              <button
                key={q.id}
                onClick={() => {
                  setSelectedId(q.id);
                  setDone(null);
                }}
                className={cx(
                  "block w-full rounded-lg border px-3 py-2.5 text-left text-sm transition",
                  selected?.id === q.id
                    ? "border-cyan-400/60 bg-cyan-500/10"
                    : "border-slate-800 hover:border-slate-700 hover:bg-white/[0.03]",
                )}
              >
                <div className="line-clamp-2 text-slate-200">{q.stem}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
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
  );
}

function ReviewPanel({ question: q, onDone }: { question: Question; onDone: (msg: string) => void }) {
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
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
    setBusy(kind);
    setError(null);
    try {
      await api(`/reviews/${q.id}/${kind}`, {
        method: "POST",
        json: kind === "reject" ? { feedback } : { feedback: feedback.trim() || null },
      });
      onDone(
        kind === "approve"
          ? `Question #${q.id} approved and sealed into the vault.`
          : `Question #${q.id} returned to its author with your feedback.`,
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  const topMatch = similar.data?.[0];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-400">
          <span>#{q.id}</span>·<span>{q.subject}</span>·<span>{q.topic}</span>
          <Badge value={q.difficulty} />
          <span>
            · {q.marks} mark{q.marks === 1 ? "" : "s"}
          </span>
          <span className="ml-auto text-xs">Submitted {fmtDateTime(q.updated_at)}</span>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-lg text-white">{q.stem}</p>
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="Question diagram" className="mt-4 max-h-72 rounded-lg border border-slate-700" />
        )}
        <ol className="mt-5 space-y-2">
          {(q.options ?? []).map((o, i) => (
            <li
              key={i}
              className={cx(
                "flex gap-3 rounded-lg border px-3 py-2 text-sm",
                i === q.correct_option
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                  : "border-slate-800 text-slate-300",
              )}
            >
              <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
              <span className="flex-1">{o}</span>
              {i === q.correct_option && <span className="text-xs text-emerald-300">marked correct</span>}
            </li>
          ))}
        </ol>
        {q.explanation && (
          <div className="mt-4 rounded-lg bg-white/[0.03] p-3 text-sm text-slate-300">
            <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">Author&apos;s explanation</div>
            {q.explanation}
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-medium text-white">Duplicate check</h3>
        <p className="mt-1 text-xs text-slate-500">
          TF-IDF similarity against approved {q.subject} questions. Only IDs are shown, because vault content stays sealed.
        </p>
        {similar.loading ? (
          <p className="mt-3 text-sm text-slate-400">Checking…</p>
        ) : similar.error ? (
          <p className="mt-3 text-sm text-rose-300">{similar.error}</p>
        ) : !topMatch ? (
          <p className="mt-3 text-sm text-slate-400">No approved questions in this subject yet.</p>
        ) : (
          <>
            {topMatch.similarity >= 0.85 && (
              <div className="mt-3">
                <Alert>
                  Likely duplicate of approved question #{topMatch.question_id} (
                  {Math.round(topMatch.similarity * 100)}% similar).
                </Alert>
              </div>
            )}
            <ul className="mt-3 space-y-1.5">
              {similar.data!.map((s) => (
                <li key={s.question_id} className="flex items-center gap-3 text-sm">
                  <span className="w-14 text-slate-400">#{s.question_id}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={cx("h-full", s.similarity >= 0.85 ? "bg-rose-400" : s.similarity >= 0.5 ? "bg-amber-400" : "bg-cyan-400")}
                      style={{ width: `${Math.round(s.similarity * 100)}%` }}
                    />
                  </div>
                  <span className="w-12 text-right tabular-nums text-slate-300">{Math.round(s.similarity * 100)}%</span>
                  <span className="w-32 truncate text-xs text-slate-500">
                    {s.topic} · {s.difficulty}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <Field label="Feedback" hint="Required to reject. Optional note when approving.">
          <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} />
        </Field>
        {error && (
          <div className="mt-3">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Button onClick={() => decide("approve")} busy={busy === "approve"} disabled={busy !== null}>
            Approve &amp; seal
          </Button>
          <Button
            variant="danger"
            onClick={() => decide("reject")}
            busy={busy === "reject"}
            disabled={busy !== null || feedback.trim().length < 3}
          >
            Reject with feedback
          </Button>
        </div>
      </Card>
    </div>
  );
}
