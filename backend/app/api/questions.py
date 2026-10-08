from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, undefer

from app.api.deps import get_current_user, require_admin, require_author, require_reviewer
from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.db import get_db
from app.models import Difficulty, Question, QuestionStatus, Role, User
from app.schemas import (
    ApproveRequest,
    QuestionContent,
    QuestionMeta,
    QuestionOut,
    QuestionUpdate,
    RejectRequest,
    SimilarQuestion,
)
from app.services import audit
from app.services.content import seal_question
from app.services.generator import load_pool, similar_items

router = APIRouter(tags=["questions"])

EDITABLE = (QuestionStatus.DRAFT, QuestionStatus.REJECTED)
_IMAGE_SIGNATURES = {
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
}


def _sniff_image(data: bytes) -> str | None:
    for sig, mime in _IMAGE_SIGNATURES.items():
        if data.startswith(sig):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _out(q: Question) -> QuestionOut:
    return QuestionOut.model_validate(q, from_attributes=True).model_copy(
        update={"has_image": q.image_mime is not None}
    )


def _get(db: Session, question_id: int) -> Question:
    q = db.get(Question, question_id)
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    return q


def _can_read_content(user: User, q: Question) -> bool:
    if user.role == Role.AUTHOR:
        return q.author_id == user.id
    if user.role == Role.REVIEWER:
        return q.status == QuestionStatus.SUBMITTED
    return False


def _own_editable(user: User, q: Question) -> None:
    if q.author_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    if q.status not in EDITABLE:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A {q.status.value} question can't be edited"
        )


# ---------- author ----------
@router.post("/questions", response_model=QuestionOut, status_code=201)
def create_question(
    body: QuestionContent, author: User = Depends(require_author), db: Session = Depends(get_db)
) -> QuestionOut:
    q = Question(author_id=author.id, status=QuestionStatus.DRAFT, **body.model_dump())
    db.add(q)
    db.flush()
    audit.record(db, "question.created", actor=author, entity_type="question", entity_id=q.id)
    db.commit()
    return _out(q)


@router.get("/questions/mine", response_model=list[QuestionOut])
def my_questions(
    status_filter: QuestionStatus | None = None,
    author: User = Depends(require_author),
    db: Session = Depends(get_db),
) -> list[QuestionOut]:
    q = select(Question).where(Question.author_id == author.id).order_by(Question.id.desc())
    if status_filter is not None:
        q = q.where(Question.status == status_filter)
    return [_out(x) for x in db.execute(q).scalars()]


@router.patch("/questions/{question_id}", response_model=QuestionOut)
def update_question(
    question_id: int,
    body: QuestionUpdate,
    author: User = Depends(require_author),
    db: Session = Depends(get_db),
) -> QuestionOut:
    q = _get(db, question_id)
    _own_editable(author, q)
    current = {f: getattr(q, f) for f in QuestionContent.model_fields}
    current.update(body.model_dump(exclude_unset=True))
    try:
        merged = QuestionContent.model_validate(current)
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False, include_context=False)) from exc
    for k, v in merged.model_dump().items():
        setattr(q, k, v)
    if q.status == QuestionStatus.REJECTED:
        q.status = QuestionStatus.DRAFT
    audit.record(db, "question.updated", actor=author, entity_type="question", entity_id=q.id)
    db.commit()
    return _out(q)


@router.delete("/questions/{question_id}", status_code=204)
def delete_question(
    question_id: int, author: User = Depends(require_author), db: Session = Depends(get_db)
) -> Response:
    q = _get(db, question_id)
    _own_editable(author, q)
    audit.record(db, "question.deleted", actor=author, entity_type="question", entity_id=q.id)
    db.delete(q)
    db.commit()
    return Response(status_code=204)


@router.post("/questions/{question_id}/submit", response_model=QuestionOut)
def submit_question(
    question_id: int, author: User = Depends(require_author), db: Session = Depends(get_db)
) -> QuestionOut:
    q = _get(db, question_id)
    _own_editable(author, q)
    q.status = QuestionStatus.SUBMITTED
    audit.record(db, "question.submitted", actor=author, entity_type="question", entity_id=q.id)
    db.commit()
    return _out(q)


@router.put("/questions/{question_id}/image", response_model=QuestionOut)
async def upload_image(
    question_id: int,
    file: UploadFile = File(...),
    author: User = Depends(require_author),
    db: Session = Depends(get_db),
) -> QuestionOut:
    q = _get(db, question_id)
    _own_editable(author, q)
    limit = get_settings().max_image_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"Image must be at most {limit // 1024} KB")
    mime = _sniff_image(data)
    if mime is None:
        raise HTTPException(415, "Only PNG, JPEG or WebP images are accepted")
    q.image, q.image_mime = data, mime
    audit.record(db, "question.image_set", actor=author, entity_type="question", entity_id=q.id)
    db.commit()
    return _out(q)


@router.delete("/questions/{question_id}/image", response_model=QuestionOut)
def delete_image(
    question_id: int, author: User = Depends(require_author), db: Session = Depends(get_db)
) -> QuestionOut:
    q = _get(db, question_id)
    _own_editable(author, q)
    q.image, q.image_mime = None, None
    db.commit()
    return _out(q)


# ---------- shared read ----------
@router.get("/questions/{question_id}", response_model=QuestionOut | QuestionMeta)
def get_question(
    question_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> QuestionOut | QuestionMeta:
    if user.role == Role.CANDIDATE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted for your role")
    q = _get(db, question_id)
    if user.role == Role.ADMIN:
        return QuestionMeta.model_validate(q)
    if not _can_read_content(user, q):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    return _out(q)


@router.get("/questions/{question_id}/image")
def get_image(
    question_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    q = db.execute(
        select(Question).where(Question.id == question_id).options(undefer(Question.image))
    ).scalar_one_or_none()
    if q is None or not _can_read_content(user, q) or q.image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return Response(q.image, media_type=q.image_mime, headers={"Cache-Control": "no-store"})


# ---------- reviewer ----------
@router.get("/reviews/queue", response_model=list[QuestionOut])
def review_queue(
    reviewer: User = Depends(require_reviewer), db: Session = Depends(get_db)
) -> list[QuestionOut]:
    rows = db.execute(
        select(Question)
        .where(Question.status == QuestionStatus.SUBMITTED)
        .where(Question.author_id != reviewer.id)
        .order_by(Question.updated_at)
    ).scalars()
    return [_out(q) for q in rows]


def _submitted(db: Session, question_id: int) -> Question:
    q = _get(db, question_id)
    if q.status != QuestionStatus.SUBMITTED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Question is not awaiting review")
    return q


@router.get("/reviews/{question_id}/similar", response_model=list[SimilarQuestion])
def similar_questions(
    question_id: int, _: User = Depends(require_reviewer), db: Session = Depends(get_db)
) -> list[SimilarQuestion]:
    """Duplicate check: closest approved questions in the same subject (ids and scores
    only; approved content stays in the vault)."""
    q = _submitted(db, question_id)
    pool = load_pool(db, q.subject)
    hits = similar_items(q.stem or "", [(p.question.id, p.content["stem"] or "") for p in pool])
    meta = {p.question.id: p.question for p in pool}
    return [
        SimilarQuestion(
            question_id=h["question_id"],
            similarity=h["similarity"],
            topic=meta[h["question_id"]].topic,
            difficulty=meta[h["question_id"]].difficulty,
        )
        for h in hits
    ]


@router.post("/reviews/{question_id}/approve", response_model=QuestionMeta)
def approve(
    question_id: int,
    body: ApproveRequest | None = None,
    reviewer: User = Depends(require_reviewer),
    db: Session = Depends(get_db),
) -> Question:
    q = db.execute(
        select(Question).where(Question.id == question_id).options(undefer(Question.image))
    ).scalar_one_or_none()
    if q is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Question not found")
    if q.status != QuestionStatus.SUBMITTED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Question is not awaiting review")
    if q.author_id == reviewer.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot review your own question")
    item = seal_question(q)
    db.add(item)
    q.status = QuestionStatus.APPROVED
    q.review_feedback = body.feedback if body else None
    q.reviewed_by, q.reviewed_at = reviewer.id, utcnow()
    audit.record(
        db,
        "question.approved",
        actor=reviewer,
        entity_type="question",
        entity_id=q.id,
        details={"content_sha256": item.content_sha256},
    )
    db.commit()
    return q


@router.post("/reviews/{question_id}/reject", response_model=QuestionOut)
def reject(
    question_id: int,
    body: RejectRequest,
    reviewer: User = Depends(require_reviewer),
    db: Session = Depends(get_db),
) -> QuestionOut:
    q = _submitted(db, question_id)
    if q.author_id == reviewer.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You cannot review your own question")
    q.status = QuestionStatus.REJECTED
    q.review_feedback = body.feedback
    q.reviewed_by, q.reviewed_at = reviewer.id, utcnow()
    audit.record(db, "question.rejected", actor=reviewer, entity_type="question", entity_id=q.id)
    db.commit()
    return _out(q)


# ---------- admin: question bank (metadata only) ----------
@router.get("/bank", response_model=list[QuestionMeta])
def question_bank(
    subject: str | None = None,
    topic: str | None = None,
    difficulty: Difficulty | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[Question]:
    q = select(Question).where(Question.status == QuestionStatus.APPROVED).order_by(Question.id)
    if subject:
        q = q.where(func.lower(Question.subject) == subject.lower())
    if topic:
        q = q.where(func.lower(Question.topic) == topic.lower())
    if difficulty:
        q = q.where(Question.difficulty == difficulty)
    return list(db.execute(q).scalars())


@router.get("/bank/summary")
def bank_summary(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[dict]:
    """Approved-question counts per subject/topic/difficulty, for blueprint planning."""
    rows = db.execute(
        select(Question.subject, Question.topic, Question.difficulty, func.count())
        .where(Question.status == QuestionStatus.APPROVED)
        .group_by(Question.subject, Question.topic, Question.difficulty)
        .order_by(Question.subject, Question.topic)
    ).all()
    return [{"subject": s, "topic": t, "difficulty": d.value, "count": c} for s, t, d, c in rows]
