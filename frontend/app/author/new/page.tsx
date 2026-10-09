import { QuestionEditor } from "@/components/QuestionEditor";
import { PageHeader } from "@/components/ui";

export default function NewQuestionPage() {
  return (
    <>
      <PageHeader title="New question" subtitle="Single-correct multiple choice." />
      <QuestionEditor />
    </>
  );
}
