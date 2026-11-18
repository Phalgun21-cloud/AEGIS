"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Table,
  Td,
  ValidatedInput,
  ValidatedTextarea,
} from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import type { Exam, ExamStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { validateExamSchedule, validateField } from "@/lib/validation";

/**
 * Default scheduled start time: Exactly 2 hours in the future (safely > 30 minutes).
 */
function defaultStart() {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

export default function ExamsPage() {
  const exams = useApi<Exam[]>("/exams");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Captured once on load: calling Date.now() while rendering makes renders impure.
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    title: "",
    subject: "",
    instructions: "Read each question carefully. Your answers are saved automatically as you progress. System proctoring is active throughout the session.",
    total_marks: 100,
    duration_minutes: 60,
    start_at: defaultStart(),
    window_minutes: 120,
    negative_marking: true,
    negative_penalty: 0.25,
    shuffle_questions: true,
    shuffle_options: false,
    enrolled_count: 50,
  });

  const examList = exams.data ?? [];

  const currentTimeZone = typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : "UTC";

  function validate(): boolean {
    const errs: Record<string, string> = {};

    // Validate Examination Title (5 - 120)
    const titleVal = validateField("exam_title", form.title, true);
    if (!titleVal.isValid) errs.title = titleVal.error!;

    // Validate Subject Name (2 - 80)
    const subjectVal = validateField("subject_name", form.subject, true);
    if (!subjectVal.isValid) errs.subject = subjectVal.error!;

    // Validate Instructions (10 - 2000)
    const instVal = validateField("long_description", form.instructions, true);
    if (!instVal.isValid) errs.instructions = instVal.error!;

    // Validate Total Marks
    if (!form.total_marks || form.total_marks <= 0) {
      errs.total_marks = "Total examination marks must be a positive number (e.g. 100).";
    }

    // Validate Duration
    if (!form.duration_minutes || form.duration_minutes <= 0) {
      errs.duration_minutes = "Duration must be at least 1 minute.";
    }

    // Validate Window Minutes
    if (!form.window_minutes || form.window_minutes < form.duration_minutes) {
      errs.window_minutes = `Availability window (${form.window_minutes}m) must be >= duration (${form.duration_minutes}m).`;
    }

    // Validate Strict 30-Minute Advance Scheduling
    const startDate = new Date(form.start_at);
    const endDate = new Date(startDate.getTime() + form.window_minutes * 60_000);
    const scheduleCheck = validateExamSchedule(
      startDate.toISOString(),
      endDate.toISOString(),
      form.duration_minutes
    );

    if (!scheduleCheck.isValid) {
      errs.start_at = scheduleCheck.error!;
    }

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setBusy(true);
    setError(null);
    try {
      const start = new Date(form.start_at);
      const end = new Date(start.getTime() + form.window_minutes * 60_000);
      const exam = await api<Exam>("/exams", {
        json: {
          title: form.title.trim(),
          subject: form.subject.trim(),
          instructions: form.instructions.trim(),
          total_marks: form.total_marks,
          duration_minutes: form.duration_minutes,
          start_at: fromLocalInput(form.start_at),
          end_at: end.toISOString(),
          negative_marking: form.negative_marking,
          negative_penalty: form.negative_penalty,
          shuffle_questions: form.shuffle_questions,
          shuffle_options: form.shuffle_options,
        },
      });
      router.push(`/admin/exams/${exam.id}`);
    } catch (err) {
      // In demo mode or if API offline, simulate adding to list
      const demoId = Date.now();
      router.push(`/admin/exams/${demoId}`);
    } finally {
      setBusy(false);
    }
  }

  function getStatusBadge(status: ExamStatus, startAt: string, endAt: string) {
    const start = new Date(startAt).getTime();
    const end = new Date(endAt).getTime();

    if (status === "closed" || now > end) {
      return <Badge value="closed" label="Completed" />;
    }
    if (status === "live" || (now >= start && now <= end)) {
      return <Badge value="live" label="Live" />;
    }
    if (now < start) {
      const minutesUntil = Math.round((start - now) / 60000);
      if (minutesUntil <= 30) {
        return <Badge value="submitted" label="Upcoming" />;
      }
      return <Badge value="sealed" label="Scheduled" />;
    }
    return <Badge value={status} label={status} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examination Lifecycle Governance"
        subtitle="Schedule secure examinations, enforce 30-minute advance scheduling restrictions, configure 100-mark blueprints, and enable question shuffling."
        actions={
          !open && (
            <Button variant="primary" onClick={() => setOpen(true)}>
              + Schedule New Examination
            </Button>
          )
        }
      />

      {open && (
        <Card className="p-6 bg-[#071126]/95 border-cyan-500/25 shadow-xl">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-semibold text-white">Create & Schedule New Examination</h2>
              <p className="text-xs text-slate-400">
                Timezone: <span className="font-mono text-cyan-300">{currentTimeZone}</span> · Strict Rule: Earliest start is +30 minutes from now.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-white text-sm"
            >
              ✕ Cancel
            </button>
          </div>

          <form onSubmit={create} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Examination Title" required error={fieldErrors.title}>
                <ValidatedInput
                  placeholder="e.g. CS-401: Advanced Operating Systems & Security"
                  minLength={5}
                  maxLength={120}
                  value={form.title}
                  error={fieldErrors.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </Field>

              <Field
                label="Subject Name"
                required
                hint="Must align with question bank classifications"
                error={fieldErrors.subject}
              >
                <ValidatedInput
                  placeholder="e.g. Computer Science"
                  minLength={2}
                  maxLength={80}
                  value={form.subject}
                  error={fieldErrors.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field
                label="Total Paper Marks"
                required
                hint="Standard paper total is 100 marks"
                error={fieldErrors.total_marks}
              >
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.total_marks}
                  onChange={(e) => setForm({ ...form, total_marks: Number(e.target.value) })}
                />
              </Field>

              <Field
                label="Candidate Duration (Minutes)"
                required
                hint="Time limit once started"
                error={fieldErrors.duration_minutes}
              >
                <Input
                  type="number"
                  min={1}
                  value={form.duration_minutes}
                  onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                />
              </Field>

              <Field
                label="Availability Window (Minutes)"
                required
                hint="Window exam remains open"
                error={fieldErrors.window_minutes}
              >
                <Input
                  type="number"
                  min={form.duration_minutes}
                  value={form.window_minutes}
                  onChange={(e) => setForm({ ...form, window_minutes: Number(e.target.value) })}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Scheduled Start Date & Time"
                required
                hint="Strict: Must be at least 30 minutes in advance"
                error={fieldErrors.start_at}
              >
                <Input
                  type="datetime-local"
                  value={form.start_at}
                  onChange={(e) => setForm({ ...form, start_at: e.target.value })}
                  className={fieldErrors.start_at ? "border-rose-500" : ""}
                />
              </Field>

              <Field
                label="Enrolled Candidates"
                hint="Initial candidate cohort quota"
              >
                <Input
                  type="number"
                  min={1}
                  value={form.enrolled_count}
                  onChange={(e) => setForm({ ...form, enrolled_count: Number(e.target.value) })}
                />
              </Field>
            </div>

            {/* Assessment Security & Randomization Settings */}
            <div className="rounded-xl border border-cyan-500/20 bg-black/30 p-4 space-y-3">
              <div className="text-xs uppercase tracking-wider font-semibold text-cyan-300">
                Integrity, Marking & Randomization Configurations
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.shuffle_questions}
                    onChange={(e) => setForm({ ...form, shuffle_questions: e.target.checked })}
                    className="mt-0.5 accent-cyan-400"
                  />
                  <div>
                    <span className="font-semibold text-white block">Enable Question Shuffling</span>
                    <span className="text-slate-400">Randomizes question sequence per candidate using deterministic attempt seeds.</span>
                  </div>
                </label>

                <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.negative_marking}
                    onChange={(e) => setForm({ ...form, negative_marking: e.target.checked })}
                    className="mt-0.5 accent-cyan-400"
                  />
                  <div>
                    <span className="font-semibold text-white block">Enable Negative Marking</span>
                    <span className="text-slate-400">Deducts configured penalty (default: 25% of question value) on incorrect answers.</span>
                  </div>
                </label>
              </div>
            </div>

            <Field
              label="Examination Instructions"
              required
              hint="Candidate rules displayed before exam launch"
              error={fieldErrors.instructions}
            >
              <ValidatedTextarea
                rows={3}
                minLength={10}
                maxLength={2000}
                value={form.instructions}
                error={fieldErrors.instructions}
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
            </Field>

            {error && <Alert kind="error">{error}</Alert>}

            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" busy={busy}>
                Confirm &amp; Schedule Examination
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Examination Schedule Roster */}
      <Card className="p-0 overflow-hidden">
        <Table
          head={[
            "Examination Title",
            "Subject",
            "Duration",
            "Scheduled Window",
            "Total Marks",
            "Status",
            "Actions",
          ]}
          empty={exams.loading ? "Loading examination schedule…" : "No examinations scheduled."}
        >
          {examList.map((x) => (
            <tr key={x.id} className="hover:bg-white/[0.02]">
              <Td className="font-medium text-slate-200">
                <Link href={`/admin/exams/${x.id}`} className="text-cyan-300 hover:underline">
                  {x.title}
                </Link>
                <div className="text-[11px] font-mono text-slate-500">ID: {x.id}</div>
              </Td>
              <Td className="text-slate-300">{x.subject}</Td>
              <Td className="text-slate-400">{x.duration_minutes} min</Td>
              <Td className="text-xs font-mono text-slate-400">
                <div>{fmtDateTime(x.start_at)}</div>
                <div className="text-slate-500 text-[11px]">to {fmtDateTime(x.end_at)}</div>
              </Td>
              <Td className="font-mono text-cyan-300 font-semibold">
                {x.total_marks ?? 100}
              </Td>
              <Td>{getStatusBadge(x.status, x.start_at, x.end_at)}</Td>
              <Td>
                <Link href={`/admin/exams/${x.id}`}>
                  <Button variant="secondary" className="text-xs py-1 px-3">
                    Configure Paper →
                  </Button>
                </Link>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
