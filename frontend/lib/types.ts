export type Role = "admin" | "author" | "reviewer" | "candidate";
export type Difficulty = "easy" | "medium" | "hard";
export type QuestionStatus = "draft" | "submitted" | "rejected" | "approved";
export type ExamStatus = "draft" | "sealed" | "live" | "closed";

export type User = {
  id: number;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
};

export type QuestionMeta = {
  id: number;
  author_id: number;
  subject: string;
  topic: string;
  difficulty: Difficulty;
  marks: number;
  status: QuestionStatus;
  review_feedback: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  usage_count: number;
  created_at: string;
  updated_at: string;
};

export type Question = QuestionMeta & {
  stem: string | null;
  options: string[] | null;
  correct_option: number | null;
  explanation: string | null;
  has_image: boolean;
};

export type QuestionInput = {
  subject: string;
  topic: string;
  difficulty: Difficulty;
  marks: number;
  stem: string;
  options: string[];
  correct_option: number;
  explanation: string | null;
};

export type SimilarQuestion = {
  question_id: number;
  similarity: number;
  topic: string;
  difficulty: Difficulty;
};

export type BlueprintItem = {
  id?: number;
  topic: string;
  difficulty: Difficulty;
  count: number;
  marks: number | null;
};

export type Exam = {
  id: number;
  title: string;
  subject: string;
  instructions: string;
  duration_minutes: number;
  start_at: string;
  end_at: string;
  status: ExamStatus;
  created_by: number;
  paper_sha256: string | null;
  total_marks: number | null;
  generated_at: string | null;
  released_at: string | null;
  blueprint: BlueprintItem[];
};

export type ManifestEntry = {
  question_id: number;
  topic: string;
  difficulty: Difficulty;
  marks: number;
};

export type GenerateResponse = {
  exam: Exam;
  manifest: ManifestEntry[];
  pool_size: number;
  duplicates_skipped: number;
};

export type Shortfall = {
  topic: string;
  difficulty: Difficulty;
  marks: number | null;
  required: number;
  available: number;
};

export type MonitorAttempt = {
  attempt_id: number;
  candidate_id: number;
  candidate_name: string;
  started_at: string;
  last_saved_at: string | null;
  answered: number;
  submitted_at: string | null;
  auto_submitted: boolean;
};

export type MonitorSnapshot = {
  exam_id: number;
  status: ExamStatus;
  server_time: string;
  start_at: string;
  end_at: string;
  questions: number;
  enrolled: number;
  started: number;
  in_progress: number;
  submitted: number;
  not_started: number;
  attempts: MonitorAttempt[];
};

export type Results = {
  exam_id: number;
  total_marks: number | null;
  candidates: number;
  average: number | null;
  highest: number | null;
  lowest: number | null;
  per_question: {
    number: number;
    question_id: number;
    attempted: number;
    correct: number;
    correct_rate: number | null;
  }[];
  attempts: {
    candidate_id: number;
    candidate_name: string;
    email: string;
    score: number | null;
    max_score: number | null;
    submitted_at: string | null;
    auto_submitted: boolean;
    answers_sha256: string | null;
  }[];
};

export type AuditEntry = {
  id: number;
  action: string;
  actor_id: number | null;
  actor_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  prev_hash: string;
  entry_hash: string;
};

export type ChainReport = {
  valid: boolean;
  entries: number;
  first_broken_id: number | null;
  head_hash: string | null;
};

export type Overview = {
  users: Partial<Record<Role, number>>;
  questions: Partial<Record<QuestionStatus, number>>;
  exams: Partial<Record<ExamStatus, number>>;
  approved_questions: number;
};

export type BankSummaryRow = {
  subject: string;
  topic: string;
  difficulty: Difficulty;
  count: number;
};

export type CandidateExam = {
  id: number;
  title: string;
  subject: string;
  instructions: string;
  duration_minutes: number;
  start_at: string;
  end_at: string;
  status: ExamStatus;
  attempt_id: number | null;
  submitted: boolean;
};

export type PaperQuestion = {
  question_id: number;
  number: number;
  marks: number;
  stem: string;
  options: string[];
  image: { mime: string; data: string } | null;
};

export type Attempt = {
  attempt_id: number;
  exam_id: number;
  title: string;
  server_time: string;
  deadline: string;
  remaining_seconds: number;
  submitted_at: string | null;
  answers: Record<string, number>;
  questions: PaperQuestion[];
};

export type SaveAck = { saved_at: string; answered: number; remaining_seconds: number };

export type Receipt = {
  attempt_id: number;
  submitted_at: string;
  auto_submitted: boolean;
  answers_sha256: string;
};
