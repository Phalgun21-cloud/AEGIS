"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Badge, Button, Card, Field, Input, PageHeader, Table, Td, Textarea } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import type { Exam } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function defaultStart() {
  const d = new Date(Date.now() + 24 * 3600_000);
  d.setMinutes(0, 0, 0);
  return toLocalInput(d);
}

export default function ExamsPage() {
  const exams = useApi<Exam[]>("/exams");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    subject: "",
    instructions: "Read each question carefully. Your answers are saved automatically.",
    duration_minutes: 60,
    start_at: defaultStart(),
    window_minutes: 90,
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const start = new Date(form.start_at);
      const end = new Date(start.getTime() + form.window_minutes * 60_000);
      const exam = await api<Exam>("/exams", {
        json: {
          title: form.title,
          subject: form.subject,
          instructions: form.instructions,
          duration_minutes: form.duration_minutes,
          start_at: fromLocalInput(form.start_at),
          end_at: end.toISOString(),
        },
      });
      router.push(`/admin/exams/${exam.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Exams"
        subtitle="Create an exam, set its blueprint, generate a sealed paper, then enrol candidates."
        actions={!open && <Button onClick={() => setOpen(true)}>New exam</Button>}
      />

      {open && (
        <Card className="mb-8">
          <form onSubmit={create} className="grid gap-4 md:grid-cols-2">
            <Field label="Title">
              <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Subject" hint="Must match the subject used on approved questions.">
              <Input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
            <Field label="Release (start) time">
              <Input
                type="datetime-local"
                required
                value={form.start_at}
                onChange={(e) => setForm({ ...form, start_at: e.target.value })}
              />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Duration (min)" hint="Per candidate">
                <Input
                  type="number"
                  min={1}
                  required
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                />
              </Field>
              <Field label="Window (min)" hint="How long the exam stays open">
                <Input
                  type="number"
                  min={1}
                  required
                  value={form.window_minutes}
                  onChange={(e) => setForm({ ...form, window_minutes: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Candidate instructions">
                <Textarea
                  value={form.instructions}
                  onChange={(e) => setForm({ ...form, instructions: e.target.value })}
                />
              </Field>
            </div>
            {error && (
              <div className="md:col-span-2">
                <Alert>{error}</Alert>
              </div>
            )}
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" busy={busy}>
                Create exam
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {exams.error && <Alert>{exams.error}</Alert>}
      <Table head={["Exam", "Status", "Release", "Closes", "Duration", "Marks"]} empty="No exams yet.">
        {(exams.data ?? []).map((e) => (
          <tr key={e.id} className="hover:bg-white/[0.02]">
            <Td>
              <Link href={`/admin/exams/${e.id}`} className="text-cyan-300 hover:underline">
                {e.title}
              </Link>
              <div className="text-xs text-slate-500">{e.subject}</div>
            </Td>
            <Td>
              <Badge value={e.status} />
            </Td>
            <Td className="whitespace-nowrap">{fmtDateTime(e.start_at)}</Td>
            <Td className="whitespace-nowrap">{fmtDateTime(e.end_at)}</Td>
            <Td>{e.duration_minutes} min</Td>
            <Td className="tabular-nums">{e.total_marks ?? "—"}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
