from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from app.models import Difficulty, ExamStatus, QuestionStatus, Role

_ORM = ConfigDict(from_attributes=True)

PASSWORD_MIN, PASSWORD_MAX = 10, 15


# ---------- auth / users ----------
class Token(BaseModel):
    access_token: str | None  # None when the session is set as an httpOnly cookie instead
    token_type: str = "bearer"
    role: Role


class UserOut(BaseModel):
    model_config = _ORM
    id: int
    email: str
    full_name: str
    role: Role
    is_active: bool


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=1, max_length=255)
    # Account policy: 10-15 characters, for every role. (15 characters is at most 60 bytes,
    # inside bcrypt's 72-byte limit, so nothing is ever silently truncated.)
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    role: Role


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    is_active: bool | None = None


# ---------- questions ----------
class QuestionContent(BaseModel):
    subject: str = Field(min_length=1, max_length=100)
    topic: str = Field(min_length=1, max_length=100)
    difficulty: Difficulty
    marks: int = Field(default=1, ge=1, le=100)
    stem: str = Field(min_length=1, max_length=10_000)
    options: list[str] = Field(min_length=2, max_length=8)
    correct_option: int = Field(ge=0)
    explanation: str | None = Field(default=None, max_length=10_000)

    @field_validator("options")
    @classmethod
    def _options_not_blank(cls, v: list[str]) -> list[str]:
        v = [o.strip() for o in v]
        if any(not o for o in v):
            raise ValueError("options must not be blank")
        if len(set(v)) != len(v):
            raise ValueError("options must be distinct")
        return v

    @model_validator(mode="after")
    def _answer_in_range(self) -> "QuestionContent":
        if self.correct_option >= len(self.options):
            raise ValueError("correct_option must index one of the options")
        return self


class QuestionUpdate(BaseModel):
    """Partial edit; the merged result is re-validated as QuestionContent."""

    subject: str | None = None
    topic: str | None = None
    difficulty: Difficulty | None = None
    marks: int | None = None
    stem: str | None = None
    options: list[str] | None = None
    correct_option: int | None = None
    explanation: str | None = None


class QuestionMeta(BaseModel):
    model_config = _ORM
    id: int
    author_id: int
    subject: str
    topic: str
    difficulty: Difficulty
    marks: int
    status: QuestionStatus
    review_feedback: str | None
    reviewed_by: int | None
    reviewed_at: datetime | None
    usage_count: int
    created_at: datetime
    updated_at: datetime


class QuestionOut(QuestionMeta):
    """Includes plaintext content; only for unapproved questions."""

    stem: str | None
    options: list[str] | None
    correct_option: int | None
    explanation: str | None
    has_image: bool = False


class RejectRequest(BaseModel):
    feedback: str = Field(min_length=3, max_length=5_000)


class ApproveRequest(BaseModel):
    feedback: str | None = Field(default=None, max_length=5_000)


class SimilarQuestion(BaseModel):
    question_id: int
    similarity: float
    topic: str
    difficulty: Difficulty


# ---------- exams ----------
class BlueprintItemIn(BaseModel):
    topic: str = Field(min_length=1, max_length=100)
    difficulty: Difficulty
    count: int = Field(ge=1, le=500)
    marks: int | None = Field(default=None, ge=1, le=100)


class BlueprintItemOut(BlueprintItemIn):
    model_config = _ORM
    id: int


class ExamCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=1, max_length=100)
    instructions: str = Field(default="", max_length=20_000)
    duration_minutes: int = Field(ge=1, le=24 * 60)
    start_at: datetime
    end_at: datetime | None = None  # defaults to start_at + duration

    @model_validator(mode="after")
    def _window(self) -> "ExamCreate":
        if self.end_at is not None and self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class ExamUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    subject: str | None = Field(default=None, min_length=1, max_length=100)
    instructions: str | None = Field(default=None, max_length=20_000)
    duration_minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    start_at: datetime | None = None
    end_at: datetime | None = None


class ExamOut(BaseModel):
    model_config = _ORM
    id: int
    title: str
    subject: str
    instructions: str
    duration_minutes: int
    start_at: datetime
    end_at: datetime
    status: ExamStatus
    created_by: int
    paper_sha256: str | None
    total_marks: int | None
    generated_at: datetime | None
    released_at: datetime | None
    blueprint: list[BlueprintItemOut]


class ShortfallOut(BaseModel):
    topic: str
    difficulty: str
    marks: int | None
    required: int
    available: int


class GenerateResponse(BaseModel):
    exam: ExamOut
    manifest: list[dict]
    pool_size: int
    duplicates_skipped: int


class EnrollRequest(BaseModel):
    candidate_ids: list[int] = Field(min_length=1, max_length=10_000)


# ---------- candidate ----------
class CandidateExamOut(BaseModel):
    id: int
    title: str
    subject: str
    instructions: str
    duration_minutes: int
    start_at: datetime
    end_at: datetime
    status: ExamStatus
    attempt_id: int | None
    submitted: bool


class AttemptOut(BaseModel):
    attempt_id: int
    exam_id: int
    title: str
    server_time: datetime
    deadline: datetime
    remaining_seconds: int
    submitted_at: datetime | None
    answers: dict[str, int]
    questions: list[dict]


class SaveAnswers(BaseModel):
    # {question_id: option index, or null to clear}
    answers: dict[str, int | None] = Field(max_length=1_000)


class SaveAck(BaseModel):
    saved_at: datetime
    answered: int
    remaining_seconds: int


class SubmissionReceipt(BaseModel):
    attempt_id: int
    submitted_at: datetime
    auto_submitted: bool
    answers_sha256: str
