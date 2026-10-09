import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.timeutil import utcnow
from app.db import Base
from app.models.types import Blob, enum_values


class Difficulty(str, enum.Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class QuestionStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    REJECTED = "rejected"
    APPROVED = "approved"


class Question(Base):
    """A single-correct MCQ.

    Content fields (stem/options/answer/image) are plaintext only while the question is
    with its author or reviewer. On approval they are sealed into `VaultItem` and cleared
    here, so the bank holds approved content only in encrypted form.
    """

    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    subject: Mapped[str] = mapped_column(String(100), index=True)
    topic: Mapped[str] = mapped_column(String(100), index=True)
    difficulty: Mapped[Difficulty] = mapped_column(Enum(Difficulty, values_callable=enum_values))
    marks: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[QuestionStatus] = mapped_column(
        Enum(QuestionStatus, values_callable=enum_values),
        default=QuestionStatus.DRAFT,
        index=True,
    )

    stem: Mapped[str | None] = mapped_column(Text, nullable=True)
    options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    correct_option: Mapped[int | None] = mapped_column(Integer, nullable=True)
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    image: Mapped[bytes | None] = mapped_column(Blob, nullable=True, deferred=True)
    image_mime: Mapped[str | None] = mapped_column(String(50), nullable=True)

    review_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    usage_count: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    vault: Mapped["VaultItem | None"] = relationship(back_populates="question", uselist=False)


class VaultItem(Base):
    __tablename__ = "vault_items"

    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), primary_key=True)
    ciphertext: Mapped[bytes] = mapped_column(Blob)
    nonce: Mapped[bytes] = mapped_column(Blob)
    wrapped_key: Mapped[bytes] = mapped_column(Blob)
    content_sha256: Mapped[str] = mapped_column(String(64))
    sealed_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    question: Mapped[Question] = relationship(back_populates="vault")
