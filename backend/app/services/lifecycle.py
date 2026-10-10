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

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.db import SessionLocal
from app.models import Attempt, Exam, ExamStatus
from app.services import audit
from app.services.content import open_paper

log = logging.getLogger("aegis.release")


def _transition(db: Session, exam: Exam, frm: ExamStatus, to: ExamStatus, **values) -> bool:
    """Atomically move `exam` from `frm` to `to`. Many requests may notice the same due
    transition at once; exactly one wins (and audits it), the rest just see the new state."""
    won = (
        db.execute(
            update(Exam)
            .where(Exam.id == exam.id, Exam.status == frm)
            .values(status=to, **values)
            .execution_options(synchronize_session=False)
        ).rowcount
        == 1
    )
    # A locking read returns the latest committed row, not this transaction's older snapshot
    # (MySQL REPEATABLE READ), so a request that lost the race sees the exam as live.
    db.refresh(exam, with_for_update=True)
    return won


def refresh_exam(db: Session, exam: Exam, now: datetime) -> None:
    if exam.status == ExamStatus.SEALED and now >= exam.start_at:
        paper = open_paper(exam, now)  # also proves the sealed paper still decrypts
        if _transition(db, exam, ExamStatus.SEALED, ExamStatus.LIVE, released_at=now):
            audit.record(
                db,
                "paper.released",
                entity_type="exam",
                entity_id=exam.id,
                details={
                    "paper_sha256": exam.paper_sha256,
                    "questions": len(paper["questions"]),
                },
            )
    due_to_close = exam.status == ExamStatus.LIVE and now >= exam.end_at
    if due_to_close and _transition(db, exam, ExamStatus.LIVE, ExamStatus.CLOSED):
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


def answers_digest(attempt: Attempt, submitted_at: datetime | None = None) -> str:
    body = {
        "attempt_id": attempt.id,
        "exam_id": attempt.exam_id,
        "candidate_id": attempt.candidate_id,
        "answers": attempt.answers,
        "submitted_at": (submitted_at or attempt.submitted_at).isoformat(timespec="seconds"),
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
    submitted_at = min(now, attempt.deadline).replace(microsecond=0)
    digest = answers_digest(attempt, submitted_at)
    # Compare-and-set: of a manual submit racing the auto-submit (or a double click), exactly
    # one takes effect. The digest covers the answers as stored, which this guards too.
    won = (
        db.execute(
            update(Attempt)
            .where(Attempt.id == attempt.id, Attempt.submitted_at.is_(None))
            .values(
                submitted_at=submitted_at,
                auto_submitted=auto,
                score=score,
                max_score=max_score,
                answers_sha256=digest,
            )
            .execution_options(synchronize_session=False)
        ).rowcount
        == 1
    )
    db.refresh(attempt, with_for_update=True)
    if not won:
        return
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
    # Optional Phase 4 anchoring; kept separate so a chain outage never blocks a release.
    from app.services.anchor import get_client, maybe_anchor

    client = get_client()
    if client is not None:
        try:
            with SessionLocal() as db:
                maybe_anchor(db, client)
        except Exception:
            log.exception("audit anchoring failed")
