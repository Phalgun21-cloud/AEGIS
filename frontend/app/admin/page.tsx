"use client";

import Link from "next/link";

import { Alert, Badge, Card, Loading, PageHeader, Stat, Table, Td } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Exam, Overview } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function AdminDashboard() {
  const overview = useApi<Overview>("/exams/stats/overview");
  const exams = useApi<Exam[]>("/exams");

  if (overview.loading && !overview.data) return <Loading />;
  if (overview.error) return <Alert>{overview.error}</Alert>;
  const o = overview.data!;
  const upcoming = (exams.data ?? []).filter((e) => e.status !== "closed").slice(0, 6);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Examination lifecycle at a glance" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Approved questions" value={o.approved_questions} hint="Encrypted in the vault" />
        <Stat label="Awaiting review" value={o.questions.submitted ?? 0} />
        <Stat label="Live exams" value={o.exams.live ?? 0} />
        <Stat label="Candidates" value={o.users.candidate ?? 0} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-400">
            Upcoming and live exams
          </h2>
          <Table head={["Exam", "Status", "Starts"]} empty="No exams scheduled.">
            {upcoming.map((e) => (
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
                <Td>{fmtDateTime(e.start_at)}</Td>
              </tr>
            ))}
          </Table>
        </div>
        <Card>
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-slate-400">Pipeline</h2>
          <dl className="space-y-3 text-sm">
            {(
              [
                ["Draft questions", o.questions.draft],
                ["Submitted for review", o.questions.submitted],
                ["Rejected", o.questions.rejected],
                ["Approved (vault)", o.questions.approved],
                ["Exams in draft", o.exams.draft],
                ["Papers sealed", o.exams.sealed],
                ["Exams closed", o.exams.closed],
                ["Authors / reviewers", `${o.users.author ?? 0} / ${o.users.reviewer ?? 0}`],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-slate-400">{k}</dt>
                <dd className="tabular-nums text-slate-100">{v ?? 0}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </>
  );
}
