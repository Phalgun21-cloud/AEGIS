"use client";

import Link from "next/link";
import { useState } from "react";

import { Alert, Badge, Button, PageHeader, Table, Td, Tabs } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import type { Question, QuestionStatus } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Filter = "all" | QuestionStatus;

export default function AuthorHome() {
  const questions = useApi<Question[]>("/questions/mine");
  const [filter, setFilter] = useState<Filter>("all");
  const all = questions.data ?? [];
  const count = (s: QuestionStatus) => all.filter((q) => q.status === s).length;
  const shown = filter === "all" ? all : all.filter((q) => q.status === filter);

  return (
    <>
      <PageHeader
        title="My Questions"
        subtitle="Write questions, save drafts and submit them for review. Approved questions move into the encrypted vault."
        actions={
          <Link href="/author/new">
            <Button>New question</Button>
          </Link>
        }
      />
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "all", label: `All (${all.length})` },
          { id: "draft", label: `Drafts (${count("draft")})` },
          { id: "rejected", label: `Needs changes (${count("rejected")})` },
          { id: "submitted", label: `In review (${count("submitted")})` },
          { id: "approved", label: `Approved (${count("approved")})` },
        ]}
      />
      {questions.error && <Alert>{questions.error}</Alert>}
      <Table head={["Question", "Subject / Topic", "Difficulty", "Status", "Updated"]} empty={questions.loading ? "Loading…" : "No questions here."}>
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
            <Td>
              <Badge value={q.difficulty} />
            </Td>
            <Td>
              <Badge value={q.status} label={q.status === "rejected" ? "needs changes" : undefined} />
            </Td>
            <Td className="whitespace-nowrap">{fmtDateTime(q.updated_at)}</Td>
          </tr>
        ))}
      </Table>
    </>
  );
}
