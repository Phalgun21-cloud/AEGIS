import type { AnswerValue, EvaluationStatus, PaperQuestion, QuestionType } from "./types";

export type MarkingScheme = {
  apply_negative_marking?: boolean;
  default_negative_percentage?: number; // e.g. 0.25 = 25% of question marks
  allow_partial_marking?: boolean;
  pass_percentage?: number; // e.g. 40
};

export type QuestionScoreResult = {
  question_id: number;
  number: number;
  question_type: QuestionType;
  max_marks: number;
  negative_marks: number;
  awarded_marks: number;
  status: EvaluationStatus;
  user_answer: AnswerValue | undefined;
  correct_answer?: AnswerValue;
  feedback?: string;
};

export type ExamScoreSummary = {
  total_questions: number;
  answered_count: number;
  unanswered_count: number;
  marked_for_review_count: number;
  pending_evaluation_count: number;
  correct_count: number;
  incorrect_count: number;
  max_marks: number;
  obtained_marks: number;
  percentage: number;
  passed?: boolean;
  results_released: boolean;
  question_scores: QuestionScoreResult[];
};

/**
 * Normalizes text input for string comparisons (trims, lowers, strips multiple spaces)
 */
function normalizeText(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Determines whether an answer is provided for a given question type.
 */
export function isAnswerProvided(answer: AnswerValue | undefined | null): boolean {
  if (answer === undefined || answer === null) return false;
  if (typeof answer === "string") return answer.trim().length > 0;
  if (typeof answer === "number") return !Number.isNaN(answer);
  if (Array.isArray(answer)) return answer.length > 0;
  return false;
}

/**
 * Reusable, centralized examination marks calculation engine.
 *
 * @param questions List of questions in the exam paper
 * @param answers Map of question_id -> candidate's answer
 * @param scheme Configuration for negative marking, partial marks, pass criteria
 * @param resultsReleased Whether correct answers and scores are officially released
 */
export function calculateExaminationScore(
  questions: PaperQuestion[],
  answers: Record<string, AnswerValue | undefined>,
  scheme: MarkingScheme = {},
  resultsReleased: boolean = false
): ExamScoreSummary {
  const {
    apply_negative_marking = true,
    default_negative_percentage = 0.25,
    allow_partial_marking = true,
    pass_percentage = 40,
  } = scheme;

  let totalMaxMarks = 0;
  let totalObtainedMarks = 0;
  let answeredCount = 0;
  let unansweredCount = 0;
  let pendingCount = 0;
  let correctCount = 0;
  let incorrectCount = 0;

  const questionScores: QuestionScoreResult[] = [];

  for (const q of questions) {
    const key = String(q.question_id);
    const userAnswer = answers[key];
    const qType: QuestionType = q.question_type ?? (q.options ? "mcq_single" : "short_answer");
    const maxMarks = Math.max(0, Number(q.marks) || 1);
    totalMaxMarks += maxMarks;

    // Determine negative marks configured on the question or by default scheme
    let negMarks = 0;
    if (apply_negative_marking) {
      if (typeof q.negative_marks === "number" && q.negative_marks >= 0) {
        negMarks = q.negative_marks;
      } else if (default_negative_percentage > 0) {
        negMarks = Math.round(maxMarks * default_negative_percentage * 100) / 100;
      }
    }

    if (!isAnswerProvided(userAnswer)) {
      unansweredCount++;
      questionScores.push({
        question_id: q.question_id,
        number: q.number,
        question_type: qType,
        max_marks: maxMarks,
        negative_marks: negMarks,
        awarded_marks: 0,
        status: "unanswered",
        user_answer: undefined,
        correct_answer: resultsReleased ? (q.correct_option ?? q.correct_options ?? q.correct_text) : undefined,
      });
      continue;
    }

    answeredCount++;

    // Evaluate based on question type
    if (qType === "long_answer") {
      // Descriptive answers cannot be fully auto-graded; require manual evaluation
      pendingCount++;
      questionScores.push({
        question_id: q.question_id,
        number: q.number,
        question_type: qType,
        max_marks: maxMarks,
        negative_marks: 0,
        awarded_marks: 0,
        status: "pending_evaluation",
        user_answer: userAnswer,
        feedback: "Awaiting invigilator / examiner grading",
      });
      continue;
    }

    let status: EvaluationStatus = "unanswered";
    let awarded = 0;

    switch (qType) {
      case "mcq_single":
      case "true_false": {
        const correct = q.correct_option ?? 0;
        const chosen = typeof userAnswer === "number" ? userAnswer : Number(userAnswer);
        if (chosen === correct) {
          status = "correct";
          awarded = maxMarks;
          correctCount++;
        } else {
          status = "incorrect";
          awarded = -negMarks;
          incorrectCount++;
        }
        break;
      }

      case "mcq_multiple": {
        const correctList = Array.isArray(q.correct_options)
          ? q.correct_options
          : q.correct_option !== undefined
            ? [q.correct_option]
            : [];
        const chosenList = Array.isArray(userAnswer)
          ? (userAnswer as number[])
          : [Number(userAnswer)];

        const correctSet = new Set(correctList);
        const chosenSet = new Set(chosenList);

        const truePositives = chosenList.filter((c) => correctSet.has(c)).length;
        const falsePositives = chosenList.filter((c) => !correctSet.has(c)).length;

        if (truePositives === correctList.length && falsePositives === 0) {
          status = "correct";
          awarded = maxMarks;
          correctCount++;
        } else if (allow_partial_marking && truePositives > 0 && falsePositives === 0) {
          status = "partial";
          awarded = Math.round((maxMarks * (truePositives / correctList.length)) * 100) / 100;
          correctCount++;
        } else {
          status = "incorrect";
          awarded = -negMarks;
          incorrectCount++;
        }
        break;
      }

      case "numerical": {
        const expected = Number(q.correct_text ?? q.correct_option ?? 0);
        const actual = Number(userAnswer);
        const tol = Math.max(0, q.tolerance ?? 0);

        if (!Number.isNaN(actual) && Math.abs(actual - expected) <= tol) {
          status = "correct";
          awarded = maxMarks;
          correctCount++;
        } else {
          status = "incorrect";
          awarded = -negMarks;
          incorrectCount++;
        }
        break;
      }

      case "short_answer": {
        const expected = normalizeText(q.correct_text ?? (q.options ? q.options[q.correct_option ?? 0] : ""));
        const actual = normalizeText(String(userAnswer));

        if (expected && actual === expected) {
          status = "correct";
          awarded = maxMarks;
          correctCount++;
        } else {
          status = "incorrect";
          awarded = -negMarks;
          incorrectCount++;
        }
        break;
      }

      default:
        status = "pending_evaluation";
        pendingCount++;
        break;
    }

    // Never exceed maximum marks for a question
    awarded = Math.min(maxMarks, awarded);
    totalObtainedMarks += awarded;

    questionScores.push({
      question_id: q.question_id,
      number: q.number,
      question_type: qType,
      max_marks: maxMarks,
      negative_marks: negMarks,
      awarded_marks: Math.round(awarded * 100) / 100,
      status,
      user_answer: userAnswer,
      correct_answer: resultsReleased ? (q.correct_option ?? q.correct_options ?? q.correct_text) : undefined,
    });
  }

  // Prevent overall negative total score unless deliberately allowed (standard AEGIS floor is 0)
  totalObtainedMarks = Math.max(0, Math.round(totalObtainedMarks * 100) / 100);

  const percentage = totalMaxMarks > 0
    ? Math.round((totalObtainedMarks / totalMaxMarks) * 10000) / 100
    : 0;

  return {
    total_questions: questions.length,
    answered_count: answeredCount,
    unanswered_count: unansweredCount,
    marked_for_review_count: 0,
    pending_evaluation_count: pendingCount,
    correct_count: correctCount,
    incorrect_count: incorrectCount,
    max_marks: totalMaxMarks,
    obtained_marks: totalObtainedMarks,
    percentage,
    passed: percentage >= pass_percentage,
    results_released: resultsReleased,
    question_scores: questionScores,
  };
}

/**
 * Calculates awarded marks for a single question.
 */
export function calculateQuestionMarks(
  q: PaperQuestion,
  userAnswer: AnswerValue | undefined,
  applyNegative: boolean = true
): { awarded: number; status: EvaluationStatus } {
  if (!isAnswerProvided(userAnswer)) {
    return { awarded: 0, status: "unanswered" };
  }
  const summary = calculateExaminationScore([q], { [String(q.question_id)]: userAnswer }, {
    apply_negative_marking: applyNegative,
  });
  const score = summary.question_scores[0];
  return {
    awarded: score?.awarded_marks ?? 0,
    status: score?.status ?? "unanswered",
  };
}

/**
 * Calculates sum of max marks across an array of questions or blueprints.
 */
export function calculateTotalMarks(items: { marks?: number | null }[]): number {
  const sum = items.reduce((acc, curr) => acc + (Number(curr.marks) || 0), 0);
  return Math.round(sum * 100) / 100;
}

/**
 * Calculates negative mark penalty for a given question mark and penalty percentage.
 */
export function calculateNegativeMarks(
  questionMarks: number,
  penaltyPercentage: number = 0.25
): number {
  if (penaltyPercentage <= 0) return 0;
  return Math.round(questionMarks * penaltyPercentage * 100) / 100;
}

/**
 * Alias for calculateExaminationScore to fulfill standardized calculation interface.
 */
export const calculateFinalScore = calculateExaminationScore;

export type PaperAllocationResult = {
  totalPaperMarks: number;
  allocatedMarks: number;
  remainingMarks: number;
  questionCount: number;
  isOverAllocated: boolean;
  isComplete: boolean;
  progressPercentage: number;
};

/**
 * Dynamic 100-Mark Paper Allocation calculation engine.
 * Remaining Marks = Total Paper Marks - Sum of All Allocated Question Marks.
 */
export function calculatePaperAllocation(
  totalPaperMarks: number,
  allocatedQuestions: { marks?: number | null }[]
): PaperAllocationResult {
  const total = Math.max(0, Number(totalPaperMarks) || 100);
  const allocated = calculateTotalMarks(allocatedQuestions);
  const remaining = Math.round((total - allocated) * 100) / 100;
  const isOverAllocated = remaining < 0;
  const isComplete = remaining === 0 && allocatedQuestions.length > 0;
  const progressPercentage = Math.min(100, Math.max(0, Math.round((allocated / total) * 100)));

  return {
    totalPaperMarks: total,
    allocatedMarks: allocated,
    remainingMarks: remaining,
    questionCount: allocatedQuestions.length,
    isOverAllocated,
    isComplete,
    progressPercentage,
  };
}

/**
 * Validates whether adding or modifying a question's marks exceeds remaining allocation.
 */
export function validateQuestionAddition(
  currentAllocatedMarks: number,
  totalPaperMarks: number,
  newQuestionMarks: number
): { allowed: boolean; error?: string } {
  const remaining = totalPaperMarks - currentAllocatedMarks;
  const roundedRemaining = Math.round(remaining * 100) / 100;
  const roundedNew = Math.round(newQuestionMarks * 100) / 100;

  if (roundedNew > roundedRemaining) {
    return {
      allowed: false,
      error: `You have only ${roundedRemaining} marks remaining. This question carries ${roundedNew} marks. Please reduce the marks or select another question.`,
    };
  }
  return { allowed: true };
}


