"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { BlueprintTab } from "@/components/admin/BlueprintTab";
import { CandidatesTab } from "@/components/admin/CandidatesTab";
import { MonitorTab } from "@/components/admin/MonitorTab";
import { PaperTab } from "@/components/admin/PaperTab";
import { ResultsTab } from "@/components/admin/ResultsTab";
import { ScheduleTab } from "@/components/admin/ScheduleTab";
import { Alert, Badge, Loading, PageHeader, Tabs } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Exam } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Tab = "schedule" | "blueprint" | "paper" | "candidates" | "monitor" | "results";

const STATUS_HELP: Record<Exam["status"], string> = {
  draft: "Set the blueprint and generate a paper to seal this exam.",
  sealed: "The paper is encrypted and cannot be opened by anyone until the release time.",
  live: "Released. Enrolled candidates can start their attempt.",
  closed: "The window is over. Results are available.",
};

export default function ExamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const exam = useApi<Exam>(`/exams/${id}`);
  const [tab, setTab] = useState<Tab>("blueprint");

  if (exam.loading && !exam.data) return <Loading />;
  if (exam.error || !exam.data) return <Alert>{exam.error ?? "Exam not found"}</Alert>;
  const e = exam.data;
  const update = (next: Exam) => exam.setData(next);

  return (
    <>
      <Link href="/admin/exams" className="text-sm text-slate-400 hover:text-slate-200">
        ← All exams
      </Link>
      <div className="mt-3">
        <PageHeader
          title={e.title}
          subtitle={
            <>
              {e.subject} · releases {fmtDateTime(e.start_at)} · closes {fmtDateTime(e.end_at)} ·{" "}
              {e.duration_minutes} min per candidate
            </>
          }
          actions={<Badge value={e.status} />}
        />
      </div>
      <div className="mb-6">
        <Alert kind="info">{STATUS_HELP[e.status]}</Alert>
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "blueprint", label: "Blueprint" },
          { id: "paper", label: "AI Paper Generator" },
          { id: "candidates", label: "Candidates" },
          { id: "schedule", label: "Schedule" },
          { id: "monitor", label: "Live Exam" },
          { id: "results", label: "Results" },
        ]}
      />
      {tab === "schedule" && <ScheduleTab exam={e} onChange={update} />}
      {tab === "blueprint" && <BlueprintTab exam={e} onChange={update} />}
      {tab === "paper" && <PaperTab exam={e} onChange={update} />}
      {tab === "candidates" && <CandidatesTab exam={e} />}
      {tab === "monitor" && <MonitorTab exam={e} onStatus={() => void exam.reload()} />}
      {tab === "results" && <ResultsTab exam={e} />}
    </>
  );
}
