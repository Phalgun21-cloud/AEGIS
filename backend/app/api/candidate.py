from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_candidate
from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.db import get_db
from app.models import Attempt, Exam, ExamCandidate, ExamStatus, User
from app.schemas import (
    AttemptOut,
    CandidateExamOut,
    SaveAck,
    SaveAnswers,
    SubmissionReceipt,
    ViolationAck,
    ViolationReport,
)
from app.services import audit
from app.services.content import candidate_view, open_paper
from app.services.lifecycle import finalize_attempt, refresh_exam

router = APIRouter(prefix="/candidate", tags=["candidate"])


def _remaining(deadline: datetime, now: datetime) -> int:
    return max(0, int((deadline - now).total_seconds()))


def _enrolled_exam(db: Session, user: User, exam_id: int) -> Exam:
    enrolled = db.execute(
        select(ExamCandidate.id)
        .where(ExamCandidate.exam_id == exam_id)
        .where(ExamCandidate.candidate_id == user.id)
    ).first()
    exam = db.get(Exam, exam_id) if enrolled else None
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    refresh_exam(db, exam, utcnow())
    db.commit()
    return exam


def _own_attempt(
    db: Session, user: User, attempt_id: int, *, lock: bool = False
) -> tuple[Attempt, Exam]:
    attempt = db.get(Attempt, attempt_id)
    if attempt is None or attempt.candidate_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Attempt not found")
    exam = db.get(Exam, attempt.exam_id)
    refresh_exam(db, exam, utcnow())  # auto-submits if the deadline has passed
    db.commit()
    if lock:  # serialise save/submit on the same attempt
        attempt = db.get(Attempt, attempt_id, with_for_update=True, populate_existing=True)
    return attempt, exam


def _attempt_out(attempt: Attempt, exam: Exam, now: datetime) -> AttemptOut:
    paper = open_paper(exam, now)
    return AttemptOut(
        attempt_id=attempt.id,
        exam_id=exam.id,
        title=exam.title,
        server_time=now,
        deadline=attempt.deadline,
        remaining_seconds=0 if attempt.submitted_at else _remaining(attempt.deadline, now),
        submitted_at=attempt.submitted_at,
        answers={k: v for k, v in (attempt.answers or {}).items() if v is not None},
        questions=[] if attempt.submitted_at else candidate_view(paper),
        violations=attempt.violations,
        max_violations=get_settings().proctor_max_violations,
        media_required=get_settings().proctor_media_required,
        snapshot_seconds=get_settings().proctor_snapshot_seconds,
    )


@router.get("/exams", response_model=list[CandidateExamOut])
def my_exams(user: User = Depends(require_candidate), db: Session = Depends(get_db)):
    now = utcnow()
    exams = list(
        db.execute(
            select(Exam)
            .join(ExamCandidate, ExamCandidate.exam_id == Exam.id)
            .where(ExamCandidate.candidate_id == user.id)
            .order_by(Exam.start_at)
        ).scalars()
    )
    for e in exams:
        refresh_exam(db, e, now)
    db.commit()
    attempts = {
        a.exam_id: a
        for a in db.execute(select(Attempt).where(Attempt.candidate_id == user.id)).scalars()
    }
    return [
        CandidateExamOut(
            id=e.id,
            title=e.title,
            subject=e.subject,
            instructions=e.instructions,
            duration_minutes=e.duration_minutes,
            start_at=e.start_at,
            end_at=e.end_at,
            # Candidates don't need to know whether a paper has been generated yet.
            status=ExamStatus.DRAFT if e.status == ExamStatus.SEALED else e.status,
            attempt_id=attempts[e.id].id if e.id in attempts else None,
            submitted=e.id in attempts and attempts[e.id].submitted_at is not None,
            media_required=get_settings().proctor_media_required,
        )
        for e in exams
    ]


@router.post("/exams/{exam_id}/start", response_model=AttemptOut)
def start_exam(
    exam_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)
) -> AttemptOut:
    """Start, or resume, the candidate's single attempt. The deadline is fixed by the
    server at first start and never extends past the exam window."""
    exam = _enrolled_exam(db, user, exam_id)
    now = utcnow()
    attempt = db.execute(
        select(Attempt).where(Attempt.exam_id == exam.id).where(Attempt.candidate_id == user.id)
    ).scalar_one_or_none()
    if attempt is None:
        if exam.status != ExamStatus.LIVE:
            raise HTTPException(status.HTTP_409_CONFLICT, "This exam is not open")
        attempt = Attempt(
            exam_id=exam.id,
            candidate_id=user.id,
            started_at=now,
            deadline=min(now + timedelta(minutes=exam.duration_minutes), exam.end_at),
            answers={},
        )
        db.add(attempt)
        try:
            db.flush()
        except IntegrityError:  # double click: another request created it first
            db.rollback()
            return start_exam(exam_id, user, db)
        audit.record(
            db,
            "attempt.started",
            actor=user,
            entity_type="attempt",
            entity_id=attempt.id,
            details={"exam_id": exam.id},
        )
        db.commit()
    return _attempt_out(attempt, exam, now)


@router.get("/attempts/{attempt_id}", response_model=AttemptOut)
def get_attempt(
    attempt_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)
) -> AttemptOut:
    attempt, exam = _own_attempt(db, user, attempt_id)
    return _attempt_out(attempt, exam, utcnow())


@router.put("/attempts/{attempt_id}/answers", response_model=SaveAck)
def save_answers(
    attempt_id: int,
    body: SaveAnswers,
    user: User = Depends(require_candidate),
    db: Session = Depends(get_db),
) -> SaveAck:
    """Auto-save. Merges the given answers; null clears one."""
    attempt, exam = _own_attempt(db, user, attempt_id, lock=True)
    now = utcnow()
    if attempt.submitted_at is not None or now >= attempt.deadline:
        raise HTTPException(status.HTTP_409_CONFLICT, "This attempt has been submitted")
    options = {str(q["question_id"]): len(q["options"]) for q in open_paper(exam, now)["questions"]}
    answers = dict(attempt.answers or {})
    for qid, choice in body.answers.items():
        if qid not in options:
            raise HTTPException(422, f"Question {qid} is not in this paper")
        if choice is not None and not 0 <= choice < options[qid]:
            raise HTTPException(422, f"Invalid option for question {qid}")
        answers[qid] = choice
    attempt.answers = answers  # reassign so the JSON column is marked dirty
    attempt.last_saved_at = now
    db.commit()
    return SaveAck(
        saved_at=now,
        answered=sum(1 for v in answers.values() if v is not None),
        remaining_seconds=_remaining(attempt.deadline, now),
    )


@router.post("/attempts/{attempt_id}/submit", response_model=SubmissionReceipt)
def submit(
    attempt_id: int, user: User = Depends(require_candidate), db: Session = Depends(get_db)
) -> SubmissionReceipt:
    attempt, exam = _own_attempt(db, user, attempt_id, lock=True)
    if attempt.submitted_at is None:
        finalize_attempt(db, exam, attempt, utcnow(), auto=False)
        db.commit()
    return SubmissionReceipt(
        attempt_id=attempt.id,
        submitted_at=attempt.submitted_at,
        auto_submitted=attempt.auto_submitted,
        answers_sha256=attempt.answers_sha256,
        violations=attempt.violations,
        max_violations=get_settings().proctor_max_violations,
    )


@router.post("/attempts/{attempt_id}/violations", response_model=ViolationAck)
def report_violation(
    attempt_id: int,
    body: ViolationReport,
    user: User = Depends(require_candidate),
    db: Session = Depends(get_db),
) -> ViolationAck:
    """Proctoring: the exam page reports leaving full screen or switching away. A browser
    can't stop that, so it is recorded, shown to the admin, and at the configured limit the
    attempt is submitted with the answers saved so far."""
    s = get_settings()
    attempt, exam = _own_attempt(db, user, attempt_id, lock=True)
    now = utcnow()
    if attempt.submitted_at is not None or now >= attempt.deadline:
        raise HTTPException(status.HTTP_409_CONFLICT, "This attempt has been submitted")
    if body.kind == "noise":  # flagged for the admin; never ends the attempt
        attempt.noise_flags += 1
        audit.record(
            db,
            "attempt.noise",
            actor=user,
            entity_type="attempt",
            entity_id=attempt.id,
            details={"exam_id": exam.id, "count": attempt.noise_flags},
        )
        db.commit()
        return ViolationAck(
            violations=attempt.violations,
            max_violations=s.proctor_max_violations,
            counted=False,
            submitted=False,
        )
    gap = timedelta(seconds=s.proctor_violation_gap_seconds)
    if attempt.last_violation_at is not None and now - attempt.last_violation_at < gap:
        attempt.last_violation_at = now
        db.commit()
        return ViolationAck(
            violations=attempt.violations,
            max_violations=s.proctor_max_violations,
            counted=False,
            submitted=False,
        )
    attempt.violations += 1
    attempt.last_violation_at = now
    audit.record(
        db,
        "attempt.violation",
        actor=user,
        entity_type="attempt",
        entity_id=attempt.id,
        details={"exam_id": exam.id, "kind": body.kind, "count": attempt.violations},
    )
    limit_reached = 0 < s.proctor_max_violations <= attempt.violations
    if limit_reached:
        db.flush()  # finalize_attempt refreshes the row; keep the new count
        finalize_attempt(db, exam, attempt, now, auto=True)
        audit.record(
            db,
            "attempt.violation_limit",
            entity_type="attempt",
            entity_id=attempt.id,
            details={"exam_id": exam.id, "violations": attempt.violations},
        )
    db.commit()
    return ViolationAck(
        violations=attempt.violations,
        max_violations=s.proctor_max_violations,
        counted=True,
        submitted=limit_reached,
    )


@router.put("/attempts/{attempt_id}/snapshot", status_code=204)
async def upload_snapshot(
    attempt_id: int,
    request: Request,
    user: User = Depends(require_candidate),
    db: Session = Depends(get_db),
) -> Response:
    """Latest webcam frame (raw JPEG body). Only the newest is kept, for the live monitor."""
    limit = get_settings().max_snapshot_bytes
    data = b""
    async for chunk in request.stream():
        data += chunk
        if len(data) > limit:
            raise HTTPException(413, f"Snapshot must be at most {limit // 1024} KB")
    if not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(415, "Snapshot must be a JPEG image")
    attempt, _ = _own_attempt(db, user, attempt_id, lock=True)
    if attempt.submitted_at is not None or utcnow() >= attempt.deadline:
        raise HTTPException(status.HTTP_409_CONFLICT, "This attempt has been submitted")
    attempt.snapshot, attempt.snapshot_at = data, utcnow()
    db.commit()
    return Response(status_code=204)
