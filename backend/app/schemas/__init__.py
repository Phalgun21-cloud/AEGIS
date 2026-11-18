import re
from datetime import datetime, timedelta
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.models import Difficulty, ExamStatus, QuestionStatus, Role

_ORM = ConfigDict(from_attributes=True)

PASSWORD_MIN, PASSWORD_MAX = 10, 15

# ---------- shared input rules (kept in step with frontend/lib/validation.ts) ----------

# C0 controls except tab/newline/carriage return, DEL, and the Unicode bidirectional overrides
# and isolates that can make text display differently from what is stored ("Trojan Source").
_CONTROL = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u202a-\u202e\u2066-\u2069]")
_LINE_BREAK = re.compile(r"[\r\n\t]")
_SPACES = re.compile(r" {2,}")


def _no_control_chars(v: str) -> str:
    if _CONTROL.search(v):
        raise ValueError("must not contain control or text-direction characters")
    return v


def _single_line(v: str) -> str:
    if _LINE_BREAK.search(v):
        raise ValueError("must be a single line")
    return _SPACES.sub(" ", _no_control_chars(v))  # "Ada   Lovelace" -> "Ada Lovelace"


def _line(max_len: int, min_len: int = 1):
    """One stripped line of text: a name, subject, topic or title."""
    return Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=min_len, max_length=max_len),
        AfterValidator(_single_line),
    ]


def _text(max_len: int, min_len: int = 0):
    """Stripped multi-line text: a question stem, instructions or feedback."""
    return Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=min_len, max_length=max_len),
        AfterValidator(_no_control_chars),
    ]


FullName = _line(100, min_len=2)
Label = _line(80, min_len=2)  # subject, topic
Title = _line(120, min_len=5)
Option = _text(500, min_len=1)
Email = Annotated[EmailStr, Field(max_length=254)]
PositiveId = Annotated[int, Field(gt=0, le=2**31 - 1)]

# The longest an exam window may stay open, and the most a paper may hold.
MAX_WINDOW = timedelta(days=7)
MIN_DURATION = 10  # minutes a candidate gets, at the least
MAX_BLUEPRINT_ROWS = 100
MAX_PAPER_QUESTIONS = 1_000


def check_password(password: str, email: str = "", full_name: str = "") -> str:
    """Rules for a new password beyond its 10-15 character length. Raises ValueError."""
    if _CONTROL.search(password) or _LINE_BREAK.search(password):
        raise ValueError("password must not contain control characters or line breaks")
    if password != password.strip():
        raise ValueError("password must not start or end with a space")
    if len(set(password)) < 5:
        raise ValueError("password must use at least 5 different characters")
    lowered = password.lower()
    local = email.split("@")[0].lower()
    if len(local) >= 4 and local in lowered:
        raise ValueError("password must not contain the email address")
    if full_name and lowered == " ".join(full_name.lower().split()):
        raise ValueError("password must not be the user's name")
    return password


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
    email_verified: bool


class UserCreate(BaseModel):
    email: Email
    full_name: FullName
    # Account policy: 10-15 characters, for every role. (15 characters is at most 60 bytes,
    # inside bcrypt's 72-byte limit, so nothing is ever silently truncated.) Not stripped:
    # every character typed is part of the password.
    password: str = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)
    role: Role

    @model_validator(mode="after")
    def _password_rules(self) -> "UserCreate":
        check_password(self.password, self.email, self.full_name)
        return self


class UserUpdate(BaseModel):
    full_name: FullName | None = None
    is_active: bool | None = None


# ---------- questions ----------
class QuestionContent(BaseModel):
    subject: Label
    topic: Label
    difficulty: Difficulty
    marks: int = Field(default=1, ge=1, le=100)
    stem: _text(2_000, min_len=10)
    options: list[Option] = Field(min_length=2, max_length=8)
    correct_option: int = Field(ge=0, le=7)
    explanation: _text(2_000) | None = None

    @field_validator("options")
    @classmethod
    def _options_distinct(cls, v: list[str]) -> list[str]:
        # "Newton" and "newton " are the same answer to a candidate.
        if len({" ".join(o.casefold().split()) for o in v}) != len(v):
            raise ValueError("options must be distinct")
        return v

    @field_validator("explanation")
    @classmethod
    def _blank_is_none(cls, v: str | None) -> str | None:
        return v or None

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
    feedback: _text(500, min_len=5)


class ApproveRequest(BaseModel):
    feedback: _text(500) | None = None


class SimilarQuestion(BaseModel):
    question_id: int
    similarity: float
    topic: str
    difficulty: Difficulty


# ---------- exams ----------
class BlueprintItemIn(BaseModel):
    topic: Label
    difficulty: Difficulty
    count: int = Field(ge=1, le=500)
    marks: int | None = Field(default=None, ge=1, le=100)


class BlueprintItemOut(BaseModel):
    model_config = _ORM
    id: int
    topic: str
    difficulty: Difficulty
    count: int
    marks: int | None


class ExamCreate(BaseModel):
    title: Title
    subject: Label
    instructions: _text(2_000) = ""
    duration_minutes: int = Field(ge=MIN_DURATION, le=24 * 60)
    start_at: datetime
    end_at: datetime | None = None  # defaults to start_at + duration

    @model_validator(mode="after")
    def _window(self) -> "ExamCreate":
        if self.end_at is not None:
            if self.end_at <= self.start_at:
                raise ValueError("end_at must be after start_at")
            if self.end_at - self.start_at > MAX_WINDOW:
                raise ValueError("the exam window must be at most 7 days")
        return self


class ExamUpdate(BaseModel):
    title: Title | None = None
    subject: Label | None = None
    instructions: _text(2_000) | None = None
    duration_minutes: int | None = Field(default=None, ge=MIN_DURATION, le=24 * 60)
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
    candidate_ids: list[PositiveId] = Field(min_length=1, max_length=10_000)


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
    media_required: bool = False  # camera and microphone check before starting


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
    violations: int = 0
    max_violations: int = 0  # 0: violations are recorded but never end the attempt
    media_required: bool = False  # camera and microphone must stay on
    snapshot_seconds: int = 0


class SaveAnswers(BaseModel):
    # {question_id: option index, or null to clear}
    answers: dict[
        Annotated[str, StringConstraints(pattern=r"^[1-9][0-9]{0,9}$")],
        Annotated[int, Field(ge=0, le=7)] | None,
    ] = Field(max_length=MAX_PAPER_QUESTIONS)


class SaveAck(BaseModel):
    saved_at: datetime
    answered: int
    remaining_seconds: int


class SubmissionReceipt(BaseModel):
    attempt_id: int
    submitted_at: datetime
    auto_submitted: bool
    answers_sha256: str
    violations: int = 0
    max_violations: int = 0


class ViolationReport(BaseModel):
    # "noise" (sustained sound on the microphone) is only flagged; it never ends the attempt.
    kind: Literal[
        "fullscreen_exit", "tab_hidden", "window_blur", "camera_off", "camera_blocked", "noise"
    ]


class ViolationAck(BaseModel):
    violations: int
    max_violations: int
    counted: bool  # False when merged into the previous event
    submitted: bool  # the limit was reached and the attempt was submitted
