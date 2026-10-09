"""AI-assisted paper generation.

Exam blueprint -> approved question pool -> similarity/duplicate check -> topic and
difficulty matching -> constraint-based balanced selection -> generated paper.

This assists the examination admin; it does not judge academic quality (reviewers do)
and makes no claim of psychometric equivalence between papers.
"""

import random
import threading
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models import Exam, Question, QuestionStatus
from app.services.content import open_question


@dataclass
class PoolQuestion:
    question: Question
    content: dict


@dataclass
class Shortfall:
    topic: str
    difficulty: str
    marks: int | None
    required: int
    available: int


@dataclass
class GenerationResult:
    selected: list[PoolQuestion] = field(default_factory=list)
    shortfalls: list[Shortfall] = field(default_factory=list)
    duplicates_skipped: int = 0
    pool_size: int = 0


_sklearn_lock = threading.Lock()


def load_sklearn():
    """Import scikit-learn (lazily: it adds seconds to API startup).

    Serialised with a lock: two threads importing scikit-learn at the same moment can
    deadlock inside Python's import machinery (the startup warm-up and a first request).
    """
    with _sklearn_lock:
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.metrics.pairwise import cosine_similarity
    return TfidfVectorizer, cosine_similarity


def similarity_matrix(texts: list[str]):
    """Pairwise TF-IDF cosine similarity, or None when there's nothing to compare."""
    if len(texts) < 2:
        return None
    TfidfVectorizer, cosine_similarity = load_sklearn()
    try:
        tfidf = TfidfVectorizer(
            ngram_range=(1, 2),
            sublinear_tf=True,
            # Keep 1-character tokens: in maths, "x = 3" and "x = 5" are different questions.
            token_pattern=r"(?u)\b\w+\b",
        ).fit_transform(texts)
    except ValueError:  # empty vocabulary
        return None
    return cosine_similarity(tfidf)


def similar_items(text: str, others: list[tuple[int, str]], limit: int = 5) -> list[dict]:
    """Most similar (id, text) pairs to `text`, for the reviewer duplicate check."""
    if not others:
        return []
    sims = similarity_matrix([text] + [t for _, t in others])
    if sims is None:
        return []
    scored = sorted(
        ((others[i][0], float(sims[0][i + 1])) for i in range(len(others))),
        key=lambda x: x[1],
        reverse=True,
    )
    return [{"question_id": qid, "similarity": round(s, 3)} for qid, s in scored[:limit]]


def load_pool(db: Session, subject: str) -> list[PoolQuestion]:
    questions = db.execute(
        select(Question)
        .where(Question.status == QuestionStatus.APPROVED)
        .where(func.lower(Question.subject) == subject.lower())
        .options(selectinload(Question.vault))
        .order_by(Question.id)
    ).scalars()
    return [PoolQuestion(q, open_question(q.vault)) for q in questions if q.vault is not None]


def select_questions(
    exam: Exam,
    pool: list[PoolQuestion],
    threshold: float,
    rng: random.Random | None = None,
) -> GenerationResult:
    rng = rng or random.SystemRandom()
    result = GenerationResult(pool_size=len(pool))
    sims = similarity_matrix([p.content["stem"] or "" for p in pool])
    index = {id(p): i for i, p in enumerate(pool)}

    def matches(p: PoolQuestion, item) -> bool:
        q = p.question
        return (
            q.topic.lower() == item.topic.lower()
            and q.difficulty == item.difficulty
            and (item.marks is None or q.marks == item.marks)
        )

    candidates = {item.id: [p for p in pool if matches(p, item)] for item in exam.blueprint}
    # Fill the most constrained rows first so scarce questions aren't taken by easy rows.
    order = sorted(exam.blueprint, key=lambda item: len(candidates[item.id]) - item.count)

    chosen: list[PoolQuestion] = []
    chosen_idx: list[int] = []
    for item in order:
        # Balanced exposure: least-used questions first, random among equals.
        ranked = sorted(candidates[item.id], key=lambda p: (p.question.usage_count, rng.random()))
        picked = 0
        for p in ranked:
            if picked == item.count:
                break
            i = index[id(p)]
            if i in chosen_idx:
                continue
            if sims is not None and any(sims[i][j] >= threshold for j in chosen_idx):
                result.duplicates_skipped += 1
                continue
            chosen.append(p)
            chosen_idx.append(i)
            picked += 1
        if picked < item.count:
            result.shortfalls.append(
                Shortfall(item.topic, item.difficulty.value, item.marks, item.count, picked)
            )

    rng.shuffle(chosen)
    result.selected = chosen
    return result


def build_paper(exam: Exam, selected: list[PoolQuestion]) -> tuple[dict, list[dict]]:
    """Returns (sealed paper payload, non-sensitive manifest)."""
    questions, manifest = [], []
    for p in selected:
        q, c = p.question, p.content
        questions.append(
            {
                "question_id": q.id,
                "marks": q.marks,
                "stem": c["stem"],
                "options": c["options"],
                "correct_option": c["correct_option"],
                "image": c["image"],
            }
        )
        manifest.append(
            {
                "question_id": q.id,
                "topic": q.topic,
                "difficulty": q.difficulty.value,
                "marks": q.marks,
            }
        )
    return {"exam_id": exam.id, "questions": questions}, manifest
