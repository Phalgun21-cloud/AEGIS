"use client";

import Link from "next/link";

import { Alert, Badge, Button, Card, Loading, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { CandidateExam } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function state(e: CandidateExam): { label: string; badge: string; action: string | null } {
  if (e.submitted) return { label: "Submitted", badge: "approved", action: "View receipt" };
  if (e.status === "live") return { label: "Open now", badge: "live", action: e.attempt_id ? "Resume" : "View & start" };
  if (e.status === "closed") return { label: e.attempt_id ? "Closed" : "Missed", badge: "closed", action: null };
  return { label: "Upcoming", badge: "sealed", action: "Instructions" };
}

export default function CandidateHome() {
  const exams = useApi<CandidateExam[]>("/candidate/exams");

  return (
    <>
      <PageHeader title="My Exams" subtitle="Exams you are enrolled in." />
      {exams.loading && !exams.data ? (
        <Loading />
      ) : exams.error ? (
        <Alert>{exams.error}</Alert>
      ) : (exams.data ?? []).length === 0 ? (
        <Card>
          <p className="text-sm text-slate-400">You are not enrolled in any exams yet.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {exams.data!.map((e) => {
            const s = state(e);
            return (
              <Card key={e.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium text-white">{e.title}</h2>
                    <p className="text-sm text-slate-400">{e.subject}</p>
                  </div>
                  <Badge value={s.badge} label={s.label} />
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-slate-500">Opens</dt>
                  <dd>{fmtDateTime(e.start_at)}</dd>
                  <dt className="text-slate-500">Closes</dt>
                  <dd>{fmtDateTime(e.end_at)}</dd>
                  <dt className="text-slate-500">Duration</dt>
                  <dd>{e.duration_minutes} minutes</dd>
                </dl>
                {s.action && (
                  <Link href={`/candidate/exams/${e.id}`} className="mt-5 inline-block">
                    <Button variant={e.status === "live" && !e.submitted ? "primary" : "secondary"}>{s.action}</Button>
                  </Link>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
