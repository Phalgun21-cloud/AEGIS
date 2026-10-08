"""Release engine: moves exams sealed -> live -> closed on schedule and auto-submits
attempts whose time has run out.

The time check that actually guards the paper lives in `content.open_paper`, so a late or
stopped scheduler can delay status changes but can never release a paper early. Request
handlers also call `refresh_exam`, so state is correct even between scheduler ticks.
"""

import asyncio
import hashlib
import json
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.db import SessionLocal
from app.models import Attempt, Exam, ExamStatus
from app.services import audit
from app.services.content import open_paper

log = logging.getLogger("aegis.release")


def refresh_exam(db: Session, exam: Exam, now: datetime) -> None:
    if exam.status == ExamStatus.SEALED and now >= exam.start_at:
        paper = open_paper(exam, now)  # also proves the sealed paper still decrypts
        exam.status = ExamStatus.LIVE
        exam.released_at = now
        audit.record(
            db,
            "paper.released",
            entity_type="exam",
            entity_id=exam.id,
            details={"paper_sha256": exam.paper_sha256, "questions": len(paper["questions"])},
        )
    if exam.status == ExamStatus.LIVE and now >= exam.end_at:
        exam.status = ExamStatus.CLOSED
        audit.record(db, "exam.closed", entity_type="exam", entity_id=exam.id)
    if exam.status in (ExamStatus.LIVE, ExamStatus.CLOSED):
        expired = db.execute(
            select(Attempt)
            .where(Attempt.exam_id == exam.id)
            .where(Attempt.submitted_at.is_(None))
            .where(Attempt.deadline <= now)
        ).scalars()
        for attempt in expired:
            finalize_attempt(db, exam, attempt, now, auto=True)


def answers_digest(attempt: Attempt) -> str:
    body = {
        "attempt_id": attempt.id,
        "exam_id": attempt.exam_id,
        "candidate_id": attempt.candidate_id,
        "answers": attempt.answers,
        "submitted_at": attempt.submitted_at.isoformat(timespec="seconds"),
    }
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def finalize_attempt(
    db: Session, exam: Exam, attempt: Attempt, now: datetime, *, auto: bool
) -> None:
    """Lock the attempt: record submission time, score it, store a receipt hash."""
    if attempt.submitted_at is not None:
        return
    paper = open_paper(exam, now)
    answers = attempt.answers or {}
    score = max_score = 0
    for q in paper["questions"]:
        max_score += q["marks"]
        if answers.get(str(q["question_id"])) == q["correct_option"]:
            score += q["marks"]
    # An auto-submit is stamped at the deadline, not whenever the engine noticed.
    attempt.submitted_at = min(now, attempt.deadline).replace(microsecond=0)
    attempt.auto_submitted = auto
    attempt.score = score
    attempt.max_score = max_score
    attempt.answers_sha256 = answers_digest(attempt)
    audit.record(
        db,
        "attempt.auto_submitted" if auto else "attempt.submitted",
        actor=None if auto else attempt.candidate_id,
        entity_type="attempt",
        entity_id=attempt.id,
        details={"exam_id": exam.id, "answers_sha256": attempt.answers_sha256},
    )


def advance_all(db: Session, now: datetime | None = None) -> None:
    now = now or utcnow()
    exams = db.execute(
        select(Exam).where(Exam.status.in_([ExamStatus.SEALED, ExamStatus.LIVE]))
    ).scalars()
    for exam in exams:
        refresh_exam(db, exam, now)
    db.commit()


async def run_scheduler(stop: asyncio.Event) -> None:
    interval = get_settings().scheduler_interval_seconds
    while not stop.is_set():
        try:
            await asyncio.to_thread(_tick)
        except Exception:  # keep the engine alive; the error is logged
            log.exception("release engine tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except TimeoutError:
            pass


def _tick() -> None:
    with SessionLocal() as db:
        advance_all(db)
