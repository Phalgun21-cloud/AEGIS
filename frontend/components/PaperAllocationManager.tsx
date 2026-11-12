"use client";

import { useMemo, useState } from "react";

import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  Modal,
  Table,
  Td,
  ValidatedInput,
} from "@/components/ui";
import {
  calculatePaperAllocation,
  calculateTotalMarks,
  validateQuestionAddition,
} from "@/lib/marking";
import type { PaperQuestion, QuestionType } from "@/lib/types";

// Initial standard demo questions for 100-mark paper allocation demonstration
const INITIAL_DEMO_PAPER_QUESTIONS: PaperQuestion[] = [
  {
    question_id: 101,
    number: 1,
    marks: 5,
    negative_marks: 1.25,
    question_type: "mcq_single",
    stem: "Which operating system scheduling algorithm avoids indefinite starvation while prioritizing short execution times?",
    options: ["First-Come, First-Served", "Shortest Job Next with Aging", "Round Robin", "Priority Scheduling without Aging"],
    image: null,
    correct_option: 1,
  },
  {
    question_id: 102,
    number: 2,
    marks: 10,
    negative_marks: 2.5,
    question_type: "mcq_single",
    stem: "Explain why virtual memory page faults trigger traps rather than interrupts in the processor pipeline.",
    options: ["Traps are synchronous software-generated exceptions", "Interrupts are hardware-triggered", "Page faults require MMU reload", "All of the above"],
    image: null,
    correct_option: 3,
  },
  {
    question_id: 103,
    number: 3,
    marks: 5,
    negative_marks: 1.0,
    question_type: "true_false",
    stem: "Atomic compare-and-swap (CAS) instructions are sufficient to eliminate the ABA problem without pointer version tags.",
    options: ["True", "False"],
    image: null,
    correct_option: 1,
  },
  {
    question_id: 104,
    number: 4,
    marks: 20,
    negative_marks: 5.0,
    question_type: "mcq_multiple",
    stem: "Which of the following conditions MUST hold simultaneously for a multi-threaded system deadlock to occur (Coffman conditions)?",
    options: ["Mutual Exclusion", "Hold and Wait", "Preemption allowed", "Circular Wait"],
    image: null,
    correct_options: [0, 1, 3],
  },
  {
    question_id: 105,
    number: 5,
    marks: 10,
    negative_marks: 2.0,
    question_type: "short_answer",
    stem: "In cryptographic authentication, what mathematical property ensures that hashing a message is computationally irreversible?",
    options: [],
    image: null,
    correct_text: "Pre-image resistance",
  },
];

export function PaperAllocationManager({
  examTitle = "CS-401: Advanced Operating Systems & Security",
  totalPaperMarks = 100,
  initialQuestions = INITIAL_DEMO_PAPER_QUESTIONS,
  onSave,
  readOnly = false,
  isReviewer = false,
}: {
  examTitle?: string;
  totalPaperMarks?: number;
  initialQuestions?: PaperQuestion[];
  onSave?: (questions: PaperQuestion[]) => void;
  readOnly?: boolean;
  isReviewer?: boolean;
}) {
  const [questions, setQuestions] = useState<PaperQuestion[]>(initialQuestions);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);

  // New question form state
  const [newStem, setNewStem] = useState("");
  const [newMarks, setNewMarks] = useState(10);
  const [newType, setNewType] = useState<QuestionType>("mcq_single");
  const [newOptions, setNewOptions] = useState<string[]>([
    "Option A",
    "Option B",
    "Option C",
    "Option D",
  ]);

  // Recalculate paper allocation dynamically
  const allocation = useMemo(() => {
    return calculatePaperAllocation(totalPaperMarks, questions);
  }, [totalPaperMarks, questions]);

  // Update marks for an existing question in real-time
  function handleMarksChange(questionId: number, rawValue: string) {
    setError(null);
    setSuccess(null);
    const parsed = Number(rawValue);

    if (Number.isNaN(parsed) || parsed < 0) {
      setError("Marks must be a non-negative number.");
      return;
    }

    const target = questions.find((q) => q.question_id === questionId);
    if (!target) return;

    const oldMarks = target.marks;
    // Calculate allocated marks without this question
    const otherMarks = questions
      .filter((q) => q.question_id !== questionId)
      .reduce((sum, q) => sum + (Number(q.marks) || 0), 0);

    const check = validateQuestionAddition(otherMarks, totalPaperMarks, parsed);
    if (!check.allowed) {
      setError(check.error || "Marks exceed remaining paper limit.");
      return;
    }

    const updated = questions.map((q) => {
      if (q.question_id === questionId) {
        return {
          ...q,
          marks: parsed,
          negative_marks: Math.round(parsed * 0.25 * 100) / 100,
        };
      }
      return q;
    });

    setQuestions(updated);
    if (onSave) onSave(updated);
  }

  // Delete question and restore marks to remaining pool
  function handleDeleteQuestion(questionId: number) {
    setError(null);
    setSuccess(null);
    const target = questions.find((q) => q.question_id === questionId);
    const updated = questions.filter((q) => q.question_id !== questionId);

    // Re-index display numbers
    const reindexed = updated.map((q, idx) => ({ ...q, number: idx + 1 }));
    setQuestions(reindexed);
    setSuccess(`Question #${target?.number ?? questionId} removed. ${target?.marks ?? 0} marks restored to remaining paper allocation.`);
    if (onSave) onSave(reindexed);
  }

  // Add new question with marks validation
  function handleAddQuestion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!newStem.trim()) {
      setError("Question stem cannot be empty.");
      return;
    }

    // Validate marks against remaining
    const check = validateQuestionAddition(allocation.allocatedMarks, totalPaperMarks, newMarks);
    if (!check.allowed) {
      setError(check.error || "Marks exceed remaining paper allocation.");
      return;
    }

    const newQ: PaperQuestion = {
      question_id: Date.now(),
      number: questions.length + 1,
      marks: newMarks,
      negative_marks: Math.round(newMarks * 0.25 * 100) / 100,
      question_type: newType,
      stem: newStem.trim(),
      options: newType === "true_false" ? ["True", "False"] : newOptions,
      image: null,
      correct_option: 0,
    };

    const updated = [...questions, newQ];
    setQuestions(updated);
    setAddModalOpen(false);
    setNewStem("");
    setSuccess(`Question added successfully! ${newMarks} marks deducted. Remaining: ${Math.round((allocation.remainingMarks - newMarks) * 100) / 100}`);
    if (onSave) onSave(updated);
  }

  return (
    <div className="space-y-6">
      {/* Dynamic 100-Mark Paper Allocation Card */}
      <Card className="border-cyan-500/30 bg-[#071126]/90 p-6 shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-mono uppercase tracking-widest text-cyan-400 font-semibold">
              &lt;Paper Allocation&gt;
            </div>
            <h2 className="text-xl font-bold text-white mt-1">{examTitle}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Author dynamic marking engine · All questions must sum exactly to Total Paper Marks
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="rounded-lg bg-black/40 border border-slate-800 p-3 text-center min-w-[100px]">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Total Marks</div>
              <div className="text-2xl font-mono font-bold text-white">{allocation.totalPaperMarks}</div>
            </div>

            <div className="rounded-lg bg-black/40 border border-slate-800 p-3 text-center min-w-[100px]">
              <div className="text-[11px] uppercase tracking-wider text-cyan-400">Allocated</div>
              <div className="text-2xl font-mono font-bold text-cyan-300">{allocation.allocatedMarks}</div>
            </div>

            <div className="rounded-lg bg-black/40 border border-slate-800 p-3 text-center min-w-[100px]">
              <div className="text-[11px] uppercase tracking-wider text-amber-400">Remaining</div>
              <div
                className={`text-2xl font-mono font-bold ${
                  allocation.remainingMarks === 0
                    ? "text-emerald-400"
                    : allocation.remainingMarks < 0
                    ? "text-rose-400"
                    : "text-amber-300"
                }`}
              >
                {allocation.remainingMarks}
              </div>
            </div>

            <div className="rounded-lg bg-black/40 border border-slate-800 p-3 text-center min-w-[100px]">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">Questions</div>
              <div className="text-2xl font-mono font-bold text-slate-200">{allocation.questionCount}</div>
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-5 space-y-1.5">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-slate-400">Allocation Progress</span>
            <span
              className={
                allocation.isComplete
                  ? "text-emerald-400 font-semibold"
                  : allocation.isOverAllocated
                  ? "text-rose-400 font-semibold"
                  : "text-cyan-300"
              }
            >
              {allocation.progressPercentage}% ({allocation.allocatedMarks} / {allocation.totalPaperMarks} Marks)
            </span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                allocation.isComplete
                  ? "bg-emerald-500"
                  : allocation.isOverAllocated
                  ? "bg-rose-500"
                  : "bg-cyan-500"
              }`}
              style={{ width: `${allocation.progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Status Alerts */}
        <div className="mt-4">
          {allocation.isComplete ? (
            <Alert kind="success">
              ✓ Paper is fully allocated (100/100 Marks). The paper satisfies all marking scheme criteria and is eligible for reviewer approval.
            </Alert>
          ) : allocation.isOverAllocated ? (
            <Alert kind="error">
              ⚠ Over-allocation detected: Total allocated ({allocation.allocatedMarks}) exceeds maximum paper marks ({allocation.totalPaperMarks}) by {Math.abs(allocation.remainingMarks)} marks. Please reduce question weights before proceeding.
            </Alert>
          ) : (
            <Alert kind="warning">
              Notice: {allocation.remainingMarks} marks remaining to allocate. Final paper submission is locked until remaining marks reach 0.
            </Alert>
          )}
        </div>

        {error && <div className="mt-3"><Alert kind="error">{error}</Alert></div>}
        {success && <div className="mt-3"><Alert kind="success">{success}</Alert></div>}

        {/* Action Toolbar */}
        {!readOnly && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
            <div className="text-xs text-slate-400">
              Editing marks directly in the table dynamically updates remaining marks in real time.
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setAddModalOpen(true)}
                disabled={allocation.remainingMarks <= 0}
              >
                + Add Question to Paper
              </Button>
              {isReviewer ? (
                <Button
                  variant="primary"
                  disabled={!allocation.isComplete}
                  onClick={() => setSuccess("Examination paper structure and 100/100 mark allocation approved!")}
                >
                  Approve Paper (100/100)
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={!allocation.isComplete}
                  onClick={() => setSuccess("Paper submitted for Reviewer approval! Status updated to 'Submitted'.")}
                >
                  Submit Paper for Review
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Allocated Questions Table */}
      <Card className="p-0 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div>
            <h3 className="text-sm font-semibold text-white">Paper Manifest &amp; Question Weights</h3>
            <p className="text-xs text-slate-400">Adjust individual marks or remove questions to rebalance allocation</p>
          </div>
          <div className="text-xs font-mono text-cyan-300">
            Total Allocated: {allocation.allocatedMarks} / {allocation.totalPaperMarks} Marks
          </div>
        </div>

        <Table
          head={["#", "Question Stem", "Type", "Assigned Marks", "Negative Penalty", "Actions"]}
          empty="No questions allocated to this examination paper yet."
        >
          {questions.map((q) => (
            <tr key={q.question_id} className="hover:bg-white/[0.02]">
              <Td className="font-mono text-cyan-400 font-semibold w-12">
                Q{q.number}
              </Td>
              <Td className="max-w-md">
                <div className="text-slate-200 text-sm">{q.stem}</div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                  ID: #{q.question_id}
                </div>
              </Td>
              <Td>
                <Badge value="submitted" label={q.question_type ?? "mcq_single"} />
              </Td>
              <Td className="w-32">
                {readOnly ? (
                  <span className="font-mono text-base font-bold text-cyan-300">{q.marks}</span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={allocation.totalPaperMarks}
                      value={q.marks}
                      onChange={(e) => handleMarksChange(q.question_id, e.target.value)}
                      className="w-20 font-mono text-sm py-1 px-2 text-center"
                    />
                    <span className="text-xs text-slate-400">pts</span>
                  </div>
                )}
              </Td>
              <Td className="font-mono text-xs text-rose-300/80">
                -{q.negative_marks ?? Math.round(q.marks * 0.25 * 100) / 100}
              </Td>
              <Td>
                {!readOnly && (
                  <Button
                    variant="danger"
                    className="text-xs py-1 px-2.5"
                    onClick={() => handleDeleteQuestion(q.question_id)}
                  >
                    Remove &amp; Restore
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* Add Question Modal */}
      <Modal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        title="Add Question to Paper"
      >
        <form onSubmit={handleAddQuestion} className="space-y-4">
          <div className="text-xs text-slate-400">
            Remaining allocation for this examination:{" "}
            <span className="font-mono font-bold text-amber-300">{allocation.remainingMarks} Marks</span>.
            The marks configured below will be deducted immediately.
          </div>

          <Field label="Question Type" required>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as QuestionType)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="mcq_single">Single-choice MCQ</option>
              <option value="mcq_multiple">Multiple-choice MCQ</option>
              <option value="true_false">True / False</option>
              <option value="short_answer">Short Answer</option>
              <option value="long_answer">Long Answer (Descriptive)</option>
              <option value="numerical">Numerical Answer</option>
            </select>
          </Field>

          <Field label="Question Marks" required hint={`Cannot exceed ${allocation.remainingMarks} marks.`}>
            <Input
              type="number"
              min={1}
              max={allocation.remainingMarks}
              value={newMarks}
              onChange={(e) => setNewMarks(Number(e.target.value))}
              required
            />
          </Field>

          <Field label="Question Stem" required>
            <ValidatedInput
              placeholder="Enter clear, concise question statement…"
              minLength={10}
              maxLength={2000}
              value={newStem}
              onChange={(e) => setNewStem(e.target.value)}
              required
            />
          </Field>

          {error && <Alert kind="error">{error}</Alert>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setAddModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={newMarks > allocation.remainingMarks || !newStem.trim()}
            >
              Add to Paper (-{newMarks} Marks)
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

