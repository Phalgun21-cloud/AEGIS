from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.core.config import get_settings
from app.core.timeutil import to_naive_utc, utcnow
from app.db import get_db
from app.models import (
    Attempt,
    BlueprintItem,
    Exam,
    ExamCandidate,
    ExamStatus,
    Question,
    QuestionStatus,
    Role,
    User,
)
from app.schemas import (
    BlueprintItemIn,
    EnrollRequest,
    ExamCreate,
    ExamOut,
    ExamUpdate,
    GenerateResponse,
    ShortfallOut,
    UserOut,
)
from app.services import audit
from app.services.content import open_paper, seal_paper
from app.services.generator import build_paper, load_pool, select_questions
from app.services.lifecycle import refresh_exam

router = APIRouter(prefix="/exams", tags=["exams"])


def _get(db: Session, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exam not found")
    refresh_exam(db, exam, utcnow())
    db.commit()
    return exam


def _require_status(exam: Exam, *allowed: ExamStatus) -> None:
    if exam.status not in allowed:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Not allowed while the exam is {exam.status.value}"
        )


def _unseal_for_edit(db: Session, exam: Exam, admin: User) -> None:
    """Editing a sealed (not yet released) exam discards its paper."""
    if exam.status == ExamStatus.SEALED:
        _discard_paper(exam)
        audit.record(db, "paper.discarded", actor=admin, entity_type="exam", entity_id=exam.id)


def _discard_paper(exam: Exam) -> None:
    exam.status = ExamStatus.DRAFT
    exam.paper_ciphertext = exam.paper_nonce = exam.paper_wrapped_key = None
    exam.paper_sha256 = exam.paper_manifest = exam.total_marks = exam.generated_at = None


@router.post("", response_model=ExamOut, status_code=201)
def create_exam(
    body: ExamCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> Exam:
    start = to_naive_utc(body.start_at)
    end = (
        to_naive_utc(body.end_at)
        if body.end_at
        else start + timedelta(minutes=body.duration_minutes)
    )
    if start <= utcnow():
        raise HTTPException(422, "start_at must be in the future")
    exam = Exam(
        title=body.title,
        subject=body.subject,
        instructions=body.instructions,
        duration_minutes=body.duration_minutes,
        start_at=start,
        end_at=end,
        status=ExamStatus.DRAFT,
        created_by=admin.id,
    )
    db.add(exam)
    db.flush()
    audit.record(db, "exam.created", actor=admin, entity_type="exam", entity_id=exam.id)
    db.commit()
    return exam


@router.get("", response_model=list[ExamOut])
def list_exams(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[Exam]:
    now = utcnow()
    exams = list(db.execute(select(Exam).order_by(Exam.start_at.desc())).scalars())
    for e in exams:
        refresh_exam(db, e, now)
    db.commit()
    return exams


@router.get("/{exam_id}", response_model=ExamOut)
def get_exam(exam_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    return _get(db, exam_id)


@router.patch("/{exam_id}", response_model=ExamOut)
def update_exam(
    exam_id: int,
    body: ExamUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Exam:
    exam = _get(db, exam_id)
    _require_status(exam, ExamStatus.DRAFT, ExamStatus.SEALED)
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None}
    for key in ("start_at", "end_at"):
        if key in changes:
            changes[key] = to_naive_utc(changes[key])
    start = changes.get("start_at", exam.start_at)
    end = changes.get("end_at", exam.end_at)
    if "start_at" in changes and "end_at" not in changes:
        end = start + timedelta(minutes=changes.get("duration_minutes", exam.duration_minutes))
        changes["end_at"] = end
    if start <= utcnow():
        raise HTTPException(422, "start_at must be in the future")
    if end <= start:
        raise HTTPException(422, "end_at must be after start_at")
    if "subject" in changes:  # the sealed paper was drawn from the old subject
        _unseal_for_edit(db, exam, admin)
    for k, v in changes.items():
        setattr(exam, k, v)
    audit.record(
        db,
        "exam.updated",
        actor=admin,
        entity_type="exam",
        entity_id=exam.id,
        details={k: str(v) for k, v in changes.items() if k != "instructions"},
    )
    db.commit()
    return exam


@router.put("/{exam_id}/blueprint", response_model=ExamOut)
def set_blueprint(
    exam_id: int,
    items: list[BlueprintItemIn],
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Exam:
    exam = _get(db, exam_id)
    _require_status(exam, ExamStatus.DRAFT, ExamStatus.SEALED)
    _unseal_for_edit(db, exam, admin)
    exam.blueprint = [BlueprintItem(**i.model_dump()) for i in items]
    audit.record(
        db,
        "exam.blueprint_set",
        actor=admin,
        entity_type="exam",
        entity_id=exam.id,
        details={"rows": len(items), "questions": sum(i.count for i in items)},
    )
    db.commit()
    return exam


@router.post("/{exam_id}/generate", response_model=GenerateResponse)
def generate_paper(
    exam_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> GenerateResponse:
    """AI-assisted generation: select from the vault against the blueprint, then seal the
    assembled paper. Regenerating before release replaces the previous paper."""
    exam = _get(db, exam_id)
    _require_status(exam, ExamStatus.DRAFT, ExamStatus.SEALED)
    if not exam.blueprint:
        raise HTTPException(422, "Set a blueprint before generating a paper")
    pool = load_pool(db, exam.subject)
    result = select_questions(exam, pool, get_settings().duplicate_threshold)
    if result.shortfalls:
        raise HTTPException(
            422,
            {
                "message": "Not enough distinct approved questions for the blueprint",
                "shortfalls": [ShortfallOut(**s.__dict__).model_dump() for s in result.shortfalls],
                "duplicates_skipped": result.duplicates_skipped,
            },
        )
    if exam.status == ExamStatus.SEALED:
        for qid in [m["question_id"] for m in exam.paper_manifest or []]:
            prev = db.get(Question, qid)
            if prev is not None:
                prev.usage_count = max(0, prev.usage_count - 1)
    paper, manifest = build_paper(exam, result.selected)
    seal_paper(exam, paper)
    for p in result.selected:
        p.question.usage_count += 1
    exam.paper_manifest = manifest
    exam.total_marks = sum(m["marks"] for m in manifest)
    exam.generated_at = utcnow()
    exam.status = ExamStatus.SEALED
    audit.record(
        db,
        "paper.generated",
        actor=admin,
        entity_type="exam",
        entity_id=exam.id,
        details={
            "paper_sha256": exam.paper_sha256,
            "questions": len(manifest),
            "duplicates_skipped": result.duplicates_skipped,
        },
    )
    db.commit()
    return GenerateResponse(
        exam=ExamOut.model_validate(exam),
        manifest=manifest,
        pool_size=result.pool_size,
        duplicates_skipped=result.duplicates_skipped,
    )


@router.get("/{exam_id}/manifest")
def paper_manifest(
    exam_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[dict]:
    """What's in the sealed paper (ids, topic, difficulty, marks) without its content."""
    exam = _get(db, exam_id)
    if exam.paper_manifest is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No paper generated yet")
    return exam.paper_manifest


@router.post("/{exam_id}/candidates", response_model=list[UserOut])
def enroll(
    exam_id: int,
    body: EnrollRequest,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    exam = _get(db, exam_id)
    _require_status(exam, ExamStatus.DRAFT, ExamStatus.SEALED, ExamStatus.LIVE)
    ids = set(body.candidate_ids)
    users = list(db.execute(select(User).where(User.id.in_(ids))).scalars())
    bad = ids - {u.id for u in users if u.role == Role.CANDIDATE and u.is_active}
    if bad:
        raise HTTPException(422, f"Not active candidates: {sorted(bad)}")
    existing = set(
        db.execute(
            select(ExamCandidate.candidate_id).where(ExamCandidate.exam_id == exam.id)
        ).scalars()
    )
    new = ids - existing
    db.add_all(ExamCandidate(exam_id=exam.id, candidate_id=c) for c in new)
    audit.record(
        db,
        "exam.candidates_enrolled",
        actor=admin,
        entity_type="exam",
        entity_id=exam.id,
        details={"added": sorted(new)},
    )
    db.commit()
    return enrolled(exam_id, admin, db)


@router.get("/{exam_id}/candidates", response_model=list[UserOut])
def enrolled(
    exam_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)
) -> list[User]:
    return list(
        db.execute(
            select(User)
            .join(ExamCandidate, ExamCandidate.candidate_id == User.id)
            .where(ExamCandidate.exam_id == exam_id)
            .order_by(User.full_name)
        ).scalars()
    )


@router.delete("/{exam_id}/candidates/{candidate_id}", status_code=204)
def unenroll(
    exam_id: int,
    candidate_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    exam = _get(db, exam_id)
    _require_status(exam, ExamStatus.DRAFT, ExamStatus.SEALED)
    row = db.execute(
        select(ExamCandidate)
        .where(ExamCandidate.exam_id == exam_id)
        .where(ExamCandidate.candidate_id == candidate_id)
    ).scalar_one_or_none()
    if row is not None:
        db.delete(row)
        audit.record(
            db,
            "exam.candidate_removed",
            actor=admin,
            entity_type="exam",
            entity_id=exam.id,
            details={"candidate_id": candidate_id},
        )
        db.commit()


def monitor_snapshot(db: Session, exam: Exam) -> dict:
    now = utcnow()
    enrolled_count = db.execute(
        select(func.count()).select_from(ExamCandidate).where(ExamCandidate.exam_id == exam.id)
    ).scalar_one()
    rows = db.execute(
        select(Attempt, User.full_name)
        .join(User, User.id == Attempt.candidate_id)
        .where(Attempt.exam_id == exam.id)
        .order_by(Attempt.started_at)
    ).all()
    attempts = [
        {
            "attempt_id": a.id,
            "candidate_id": a.candidate_id,
            "candidate_name": name,
            "started_at": a.started_at.isoformat(),
            "last_saved_at": a.last_saved_at.isoformat() if a.last_saved_at else None,
            "answered": sum(1 for v in (a.answers or {}).values() if v is not None),
            "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
            "auto_submitted": a.auto_submitted,
        }
        for a, name in rows
    ]
    submitted = sum(1 for a in attempts if a["submitted_at"])
    return {
        "exam_id": exam.id,
        "status": exam.status.value,
        "server_time": now.isoformat(),
        "start_at": exam.start_at.isoformat(),
        "end_at": exam.end_at.isoformat(),
        "questions": len(exam.paper_manifest or []),
        "enrolled": enrolled_count,
        "started": len(attempts),
        "in_progress": len(attempts) - submitted,
        "submitted": submitted,
        "not_started": max(0, enrolled_count - len(attempts)),
        "attempts": attempts,
    }


@router.get("/{exam_id}/monitor")
def monitor(exam_id: int, _: User = Depends(require_admin), db: Session = Depends(get_db)):
    return monitor_snapshot(db, _get(db, exam_id))


@router.get("/{exam_id}/results")
def results(
    exam_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> dict:
    """Analytics, available once the exam has closed."""
    exam = _get(db, exam_id)
    _require_status(exam, ExamStatus.CLOSED)
    rows = db.execute(
        select(Attempt, User.full_name, User.email)
        .join(User, User.id == Attempt.candidate_id)
        .where(Attempt.exam_id == exam.id)
        .order_by(Attempt.score.desc())
    ).all()
    paper = open_paper(exam, utcnow())
    per_question = []
    for i, q in enumerate(paper["questions"]):
        key = str(q["question_id"])
        answered = [a.answers.get(key) for a, _, _ in rows if a.answers.get(key) is not None]
        correct = sum(1 for v in answered if v == q["correct_option"])
        per_question.append(
            {
                "number": i + 1,
                "question_id": q["question_id"],
                "attempted": len(answered),
                "correct": correct,
                "correct_rate": round(correct / len(rows), 3) if rows else None,
            }
        )
    scores = [a.score for a, _, _ in rows if a.score is not None]
    audit.record(db, "exam.results_viewed", actor=admin, entity_type="exam", entity_id=exam.id)
    db.commit()
    return {
        "exam_id": exam.id,
        "total_marks": exam.total_marks,
        "candidates": len(rows),
        "average": round(sum(scores) / len(scores), 2) if scores else None,
        "highest": max(scores) if scores else None,
        "lowest": min(scores) if scores else None,
        "per_question": per_question,
        "attempts": [
            {
                "candidate_id": a.candidate_id,
                "candidate_name": name,
                "email": email,
                "score": a.score,
                "max_score": a.max_score,
                "submitted_at": a.submitted_at,
                "auto_submitted": a.auto_submitted,
                "answers_sha256": a.answers_sha256,
            }
            for a, name, email in rows
        ],
    }


@router.get("/stats/overview")
def overview(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    def counts(col):
        return {k.value: v for k, v in db.execute(select(col, func.count()).group_by(col)).all()}

    return {
        "users": counts(User.role),
        "questions": counts(Question.status),
        "exams": counts(Exam.status),
        "approved_questions": db.execute(
            select(func.count())
            .select_from(Question)
            .where(Question.status == QuestionStatus.APPROVED)
        ).scalar_one(),
    }
