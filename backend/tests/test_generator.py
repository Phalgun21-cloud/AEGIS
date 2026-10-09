import random

from app.models import BlueprintItem, Difficulty, Exam, Question
from app.services.generator import PoolQuestion, select_questions


def _pq(qid, stem, topic="Algebra", difficulty=Difficulty.EASY, marks=1, usage=0):
    q = Question(id=qid, subject="Maths", topic=topic, difficulty=difficulty, marks=marks)
    q.usage_count = usage
    return PoolQuestion(q, {"stem": stem})


def _exam(*rows):
    exam = Exam(id=1, subject="Maths")
    exam.blueprint = [
        BlueprintItem(id=i, topic=t, difficulty=d, count=c, marks=m)
        for i, (t, d, c, m) in enumerate(rows, 1)
    ]
    return exam


def test_selects_by_topic_and_difficulty():
    pool = [
        _pq(1, "solve the linear equation 2x plus 3"),
        _pq(2, "expand the binomial expression fully"),
        _pq(3, "area of a triangle with base four", topic="Geometry"),
        _pq(4, "hard proof about primes", difficulty=Difficulty.HARD),
    ]
    exam = _exam(("Algebra", Difficulty.EASY, 2, None), ("geometry", Difficulty.EASY, 1, None))
    res = select_questions(exam, pool, 0.85, random.Random(0))
    assert not res.shortfalls
    assert sorted(p.question.id for p in res.selected) == [1, 2, 3]


def test_near_duplicates_are_not_both_selected():
    pool = [
        _pq(1, "What is the capital city of France"),
        _pq(2, "What is the capital city of France?"),
        _pq(3, "Which gas do plants absorb during photosynthesis"),
    ]
    res = select_questions(
        _exam(("Algebra", Difficulty.EASY, 2, None)), pool, 0.85, random.Random(1)
    )
    ids = {p.question.id for p in res.selected}
    assert 3 in ids and len(ids & {1, 2}) == 1


def test_shortfall_is_reported():
    pool = [_pq(1, "only one question here")]
    res = select_questions(_exam(("Algebra", Difficulty.EASY, 3, None)), pool, 0.85)
    assert res.shortfalls[0].required == 3 and res.shortfalls[0].available == 1


def test_marks_filter_and_least_used_first():
    pool = [
        _pq(1, "alpha question about sets", marks=2, usage=5),
        _pq(2, "beta question about vectors", marks=2, usage=0),
        _pq(3, "gamma question about matrices", marks=1, usage=0),
    ]
    res = select_questions(_exam(("Algebra", Difficulty.EASY, 1, 2)), pool, 0.85, random.Random(0))
    assert [p.question.id for p in res.selected] == [2]


def test_scarce_rows_are_filled_first():
    # Q1 fits both rows; row 2 can only use Q1. Filling row 1 first naively would starve row 2.
    pool = [
        _pq(1, "shared question about logarithms", marks=2),
        _pq(2, "another question on sequences", marks=1),
    ]
    exam = _exam(("Algebra", Difficulty.EASY, 1, None), ("Algebra", Difficulty.EASY, 1, 2))
    res = select_questions(exam, pool, 0.85, random.Random(0))
    assert not res.shortfalls


def test_numeric_variants_are_not_duplicates():
    # Same wording, different numbers: distinct maths questions, both selectable.
    pool = [_pq(1, "Solve for x: 2x + 3 = 11"), _pq(2, "Solve for x: 2x + 5 = 13")]
    res = select_questions(_exam(("Algebra", Difficulty.EASY, 2, None)), pool, 0.85)
    assert not res.shortfalls and res.duplicates_skipped == 0
