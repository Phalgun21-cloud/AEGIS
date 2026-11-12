"use client";

import Link from "next/link";

import { Alert, Badge, Button, Card, Loading, PageHeader } from "@/components/ui";
import { DEMO_EXAMS } from "@/lib/demoData";
import { fmtDateTime } from "@/lib/format";
import type { CandidateExam } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function state(e: CandidateExam): { label: string; badge: string; action: string | null } {
  if (e.submitted) return { label: "Submitted", badge: "approved", action: "View Receipt" };
  if (e.status === "live") return { label: "Live Now", badge: "live", action: e.attempt_id ? "Resume Exam" : "Start Exam" };
  if (e.status === "closed") return { label: e.attempt_id ? "Closed" : "Missed", badge: "closed", action: e.attempt_id ? "View Results" : null };
  return { label: "Upcoming", badge: "sealed", action: "View Instructions" };
}

export default function CandidateHome() {
  const exams = useApi<CandidateExam[]>("/candidate/exams");

  const examList = (exams.data && exams.data.length > 0) ? exams.data : DEMO_EXAMS;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Examination Portal"
        subtitle="View your enrolled assessments, review examination guidelines, and commence scheduled papers."
      />

      {exams.loading && !exams.data ? (
        <Loading label="Retrieving examination schedule…" />
      ) : exams.error && !examList.length ? (
        <Alert kind="error">{exams.error}</Alert>
      ) : examList.length === 0 ? (
        <Card className="p-8 text-center bg-[#071126]/90 border-cyan-500/20">
          <p className="text-sm text-slate-400">You are not currently enrolled in any active examinations.</p>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {examList.map((e) => {
            const s = state(e);
            return (
              <Card key={e.id} className="p-6 bg-[#071126]/90 border-cyan-500/20 shadow-lg flex flex-col justify-between">
                <div>
                  <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                    <div>
                      <h2 className="font-semibold text-white text-base md:text-lg">{e.title}</h2>
                      <p className="text-xs text-cyan-300/80 font-medium">{e.subject}</p>
                    </div>
                    <Badge value={s.badge} label={s.label} />
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-500 uppercase tracking-wider">Release (Start)</dt>
                      <dd className="font-medium text-slate-200 mt-0.5">{fmtDateTime(e.start_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-wider">Closing Window</dt>
                      <dd className="font-medium text-slate-200 mt-0.5">{fmtDateTime(e.end_at)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-wider">Allotted Time</dt>
                      <dd className="font-medium text-slate-200 mt-0.5">{e.duration_minutes} Minutes</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 uppercase tracking-wider">Security</dt>
                      <dd className="font-medium text-slate-200 mt-0.5">
                        {e.media_required ? "Proctored (Webcam/Audio)" : "Standard Sealed"}
                      </dd>
                    </div>
                  </dl>
                </div>

                {s.action && (
                  <div className="mt-6 border-t border-slate-800 pt-4">
                    <Link href={`/candidate/exams/${e.id}`} className="block w-full">
                      <Button
                        variant={e.status === "live" && !e.submitted ? "primary" : "secondary"}
                        className="w-full font-semibold"
                      >
                        {s.action} →
                      </Button>
                    </Link>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
