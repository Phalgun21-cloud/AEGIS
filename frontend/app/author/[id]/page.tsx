"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { QuestionEditor } from "@/components/QuestionEditor";
import { Alert, Loading, PageHeader } from "@/components/ui";
import type { Question } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function EditQuestionPage() {
  const { id } = useParams<{ id: string }>();
  const question = useApi<Question>(`/questions/${id}`);

  return (
    <>
      <Link href="/author" className="text-sm text-slate-400 hover:text-slate-200">
        ← My questions
      </Link>
      <div className="mt-3">
        <PageHeader title="Question" />
      </div>
      {question.loading ? (
        <Loading />
      ) : question.error || !question.data ? (
        <Alert>{question.error ?? "Question not found"}</Alert>
      ) : (
        <QuestionEditor key={question.data.id} question={question.data} />
      )}
    </>
  );
}
