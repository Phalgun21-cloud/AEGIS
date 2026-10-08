import enum
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.question import Difficulty
from app.models.types import Blob, enum_values


class ExamStatus(str, enum.Enum):
    DRAFT = "draft"  # editable; no paper yet
    SEALED = "sealed"  # paper generated and encrypted; waiting for start_at
    LIVE = "live"  # released; candidates may attempt
    CLOSED = "closed"  # window over


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(100))
    instructions: Mapped[str] = mapped_column(Text, default="")
    duration_minutes: Mapped[int] = mapped_column(Integer)
    start_at: Mapped[datetime] = mapped_column(DateTime)  # scheduled release (naive UTC)
    end_at: Mapped[datetime] = mapped_column(DateTime)  # no attempt runs past this
    status: Mapped[ExamStatus] = mapped_column(
        Enum(ExamStatus, values_callable=enum_values), default=ExamStatus.DRAFT, index=True
    )
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    paper_ciphertext: Mapped[bytes | None] = mapped_column(Blob, nullable=True, deferred=True)
    paper_nonce: Mapped[bytes | None] = mapped_column(Blob, nullable=True)
    paper_wrapped_key: Mapped[bytes | None] = mapped_column(Blob, nullable=True)
    paper_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Non-sensitive summary of the sealed paper: question ids, topic, difficulty, marks.
    paper_manifest: Mapped[list | None] = mapped_column(JSON, nullable=True)
    total_marks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    blueprint: Mapped[list["BlueprintItem"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", order_by="BlueprintItem.id"
    )


class BlueprintItem(Base):
    __tablename__ = "blueprint_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), index=True)
    topic: Mapped[str] = mapped_column(String(100))
    difficulty: Mapped[Difficulty] = mapped_column(Enum(Difficulty, values_callable=enum_values))
    count: Mapped[int] = mapped_column(Integer)
    marks: Mapped[int | None] = mapped_column(Integer, nullable=True)  # None = any marks

    exam: Mapped[Exam] = relationship(back_populates="blueprint")


class ExamCandidate(Base):
    __tablename__ = "exam_candidates"
    __table_args__ = (UniqueConstraint("exam_id", "candidate_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), index=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)


class Attempt(Base):
    __tablename__ = "attempts"
    __table_args__ = (UniqueConstraint("exam_id", "candidate_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id"), index=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime)
    deadline: Mapped[datetime] = mapped_column(DateTime)
    # {question_id (as str): chosen option index}
    answers: Mapped[dict] = mapped_column(JSON, default=dict)
    last_saved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    auto_submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    answers_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
