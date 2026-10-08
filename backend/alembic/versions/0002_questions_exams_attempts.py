"""questions, vault, exams, blueprints, enrolment, attempts

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-08
"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

BLOB = sa.LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql")
DIFFICULTY = ("easy", "medium", "hard")


def upgrade() -> None:
    op.create_table(
        "questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("author_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("subject", sa.String(100), nullable=False),
        sa.Column("topic", sa.String(100), nullable=False),
        sa.Column("difficulty", sa.Enum(*DIFFICULTY, name="difficulty"), nullable=False),
        sa.Column("marks", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("draft", "submitted", "rejected", "approved", name="questionstatus"),
            nullable=False,
        ),
        sa.Column("stem", sa.Text(), nullable=True),
        sa.Column("options", sa.JSON(), nullable=True),
        sa.Column("correct_option", sa.Integer(), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("image", BLOB, nullable=True),
        sa.Column("image_mime", sa.String(50), nullable=True),
        sa.Column("review_feedback", sa.Text(), nullable=True),
        sa.Column("reviewed_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("usage_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_questions_author_id", "questions", ["author_id"])
    op.create_index("ix_questions_subject", "questions", ["subject"])
    op.create_index("ix_questions_topic", "questions", ["topic"])
    op.create_index("ix_questions_status", "questions", ["status"])

    op.create_table(
        "vault_items",
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("questions.id"), primary_key=True),
        sa.Column("ciphertext", BLOB, nullable=False),
        sa.Column("nonce", BLOB, nullable=False),
        sa.Column("wrapped_key", BLOB, nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("sealed_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "exams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(100), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("start_at", sa.DateTime(), nullable=False),
        sa.Column("end_at", sa.DateTime(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("draft", "sealed", "live", "closed", name="examstatus"),
            nullable=False,
        ),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("paper_ciphertext", BLOB, nullable=True),
        sa.Column("paper_nonce", BLOB, nullable=True),
        sa.Column("paper_wrapped_key", BLOB, nullable=True),
        sa.Column("paper_sha256", sa.String(64), nullable=True),
        sa.Column("paper_manifest", sa.JSON(), nullable=True),
        sa.Column("total_marks", sa.Integer(), nullable=True),
        sa.Column("generated_at", sa.DateTime(), nullable=True),
        sa.Column("released_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_exams_status", "exams", ["status"])

    op.create_table(
        "blueprint_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("exam_id", sa.Integer(), sa.ForeignKey("exams.id"), nullable=False),
        sa.Column("topic", sa.String(100), nullable=False),
        sa.Column("difficulty", sa.Enum(*DIFFICULTY, name="difficulty"), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.Column("marks", sa.Integer(), nullable=True),
    )
    op.create_index("ix_blueprint_items_exam_id", "blueprint_items", ["exam_id"])

    op.create_table(
        "exam_candidates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("exam_id", sa.Integer(), sa.ForeignKey("exams.id"), nullable=False),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("exam_id", "candidate_id"),
    )
    op.create_index("ix_exam_candidates_exam_id", "exam_candidates", ["exam_id"])
    op.create_index("ix_exam_candidates_candidate_id", "exam_candidates", ["candidate_id"])

    op.create_table(
        "attempts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("exam_id", sa.Integer(), sa.ForeignKey("exams.id"), nullable=False),
        sa.Column("candidate_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("deadline", sa.DateTime(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=False),
        sa.Column("last_saved_at", sa.DateTime(), nullable=True),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("auto_submitted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("answers_sha256", sa.String(64), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("max_score", sa.Integer(), nullable=True),
        sa.UniqueConstraint("exam_id", "candidate_id"),
    )
    op.create_index("ix_attempts_exam_id", "attempts", ["exam_id"])
    op.create_index("ix_attempts_candidate_id", "attempts", ["candidate_id"])


def downgrade() -> None:
    op.drop_table("attempts")
    op.drop_table("exam_candidates")
    op.drop_table("blueprint_items")
    op.drop_table("exams")
    op.drop_table("vault_items")
    op.drop_table("questions")
