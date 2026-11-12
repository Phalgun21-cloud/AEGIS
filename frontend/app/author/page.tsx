"use client";

import Link from "next/link";
import { useState } from "react";

import { PaperAllocationManager } from "@/components/PaperAllocationManager";
import { Alert, Badge, Button, PageHeader, Table, Tabs, Td } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Question, QuestionStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type ViewMode = "questions" | "paper_allocation";
type Filter = "all" | QuestionStatus;

export default function AuthorHome() {
  const [viewMode, setViewMode] = useState<ViewMode>("paper_allocation");
  const questions = useApi<Question[]>("/questions/mine");
  const [filter, setFilter] = useState<Filter>("all");

  const all = questions.data ?? [];
  const count = (s: QuestionStatus) => all.filter((q) => q.status === s).length;
  const shown = filter === "all" ? all : all.filter((q) => q.status === filter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Author Examination & Question Studio"
        subtitle="Author items with strict character limits, allocate questions dynamically to 100-mark papers, and track reviewer approval status."
        actions={
          <div className="flex gap-2">
            <Link href="/author/new">
              <Button variant="secondary">+ Author Single Question</Button>
            </Link>
          </div>
        }
      />

      {/* Main Author Tabs */}
      <Tabs<ViewMode>
        value={viewMode}
        onChange={setViewMode}
        tabs={[
          { id: "paper_allocation", label: "Dynamic 100-Mark Paper Allocation" },
          { id: "questions", label: `My Question Bank (${all.length})` },
        ]}
      />

      {viewMode === "paper_allocation" ? (
        <PaperAllocationManager />
      ) : (
        <div className="space-y-4">
          <Tabs<Filter>
            value={filter}
            onChange={setFilter}
            tabs={[
              { id: "all", label: `All Items (${all.length})` },
              { id: "draft", label: `Drafts (${count("draft")})` },
              { id: "rejected", label: `Needs Changes (${count("rejected")})` },
              { id: "submitted", label: `In Review (${count("submitted")})` },
              { id: "approved", label: `Approved Vault (${count("approved")})` },
            ]}
          />
          {questions.error && <Alert>{questions.error}</Alert>}
          <Table
            head={["Question Stem", "Subject / Topic", "Marks", "Difficulty", "Status", "Updated"]}
            empty={questions.loading ? "Loading questions…" : "No questions in this filter."}
          >
            {shown.map((q) => (
              <tr key={q.id} className="hover:bg-white/[0.02]">
                <Td className="max-w-md">
                  <Link href={`/author/${q.id}`} className="text-cyan-300 hover:underline">
                    {q.stem ? (q.stem.length > 90 ? `${q.stem.slice(0, 90)}…` : q.stem) : `Question #${q.id} (sealed in vault)`}
                  </Link>
                  {q.status === "rejected" && q.review_feedback && (
                    <div className="mt-1 text-xs text-rose-300">Feedback: {q.review_feedback}</div>
                  )}
                </Td>
                <Td>
                  {q.subject}
                  <div className="text-xs text-slate-500">{q.topic}</div>
                </Td>
                <Td className="font-mono text-cyan-300 font-semibold">{q.marks} pts</Td>
                <Td>
                  <Badge value={q.difficulty} />
                </Td>
                <Td>
                  <Badge value={q.status} label={q.status === "rejected" ? "needs changes" : undefined} />
                </Td>
                <Td className="whitespace-nowrap font-mono text-xs text-slate-400">
                  {fmtDateTime(q.updated_at)}
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
