"use client";

import { useState } from "react";

import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fromLocalInput, parseUtc, toLocalInput } from "@/lib/format";
import type { Exam } from "@/lib/types";

export function ScheduleTab({ exam, onChange }: { exam: Exam; onChange: (e: Exam) => void }) {
  const editable = exam.status === "draft" || exam.status === "sealed";
  const [form, setForm] = useState({
    title: exam.title,
    subject: exam.subject,
    instructions: exam.instructions,
    duration_minutes: exam.duration_minutes,
    start_at: toLocalInput(parseUtc(exam.start_at)),
    end_at: toLocalInput(parseUtc(exam.end_at)),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const next = await api<Exam>(`/exams/${exam.id}`, {
        method: "PATCH",
        json: {
          ...form,
          start_at: fromLocalInput(form.start_at),
          end_at: fromLocalInput(form.end_at),
        },
      });
      onChange(next);
      setMsg({
        kind: "success",
        text:
          exam.status === "sealed" && next.status === "draft"
            ? "Saved. Changing the subject discarded the sealed paper, so generate it again."
            : "Saved.",
      });
    } catch (err) {
      setMsg({ kind: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
        <Field label="Title">
          <Input disabled={!editable} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Subject" hint={exam.status === "sealed" ? "Changing this discards the sealed paper." : undefined}>
          <Input disabled={!editable} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </Field>
        <Field label="Release (start)">
          <Input
            type="datetime-local"
            disabled={!editable}
            value={form.start_at}
            onChange={(e) => setForm({ ...form, start_at: e.target.value })}
          />
        </Field>
        <Field label="Close (end of window)">
          <Input
            type="datetime-local"
            disabled={!editable}
            value={form.end_at}
            onChange={(e) => setForm({ ...form, end_at: e.target.value })}
          />
        </Field>
        <Field label="Duration per candidate (min)">
          <Input
            type="number"
            min={1}
            disabled={!editable}
            value={form.duration_minutes}
            onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Candidate instructions">
            <Textarea
              disabled={!editable}
              value={form.instructions}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
          </Field>
        </div>
        {msg && (
          <div className="md:col-span-2">
            <Alert kind={msg.kind}>{msg.text}</Alert>
          </div>
        )}
        {editable ? (
          <div className="md:col-span-2">
            <Button type="submit" busy={busy}>
              Save changes
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500 md:col-span-2">A {exam.status} exam can no longer be edited.</p>
        )}
      </form>
    </Card>
  );
}
