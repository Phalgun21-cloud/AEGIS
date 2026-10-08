from datetime import datetime, timedelta


def question_body(stem: str, topic: str = "Algebra", difficulty: str = "easy", **kw) -> dict:
    body = {
        "subject": "Mathematics",
        "topic": topic,
        "difficulty": difficulty,
        "marks": 1,
        "stem": stem,
        "options": ["A", "B", "C", "D"],
        "correct_option": 1,
    }
    body.update(kw)
    return body


def approved_question(client, author_h, reviewer_h, stem: str, **kw) -> int:
    r = client.post("/questions", json=question_body(stem, **kw), headers=author_h)
    assert r.status_code == 201, r.text
    qid = r.json()["id"]
    assert client.post(f"/questions/{qid}/submit", headers=author_h).status_code == 200
    r = client.post(f"/reviews/{qid}/approve", headers=reviewer_h)
    assert r.status_code == 200, r.text
    return qid


STEMS = [
    "Solve for x: 2x + 3 = 11",
    "What is the derivative of x squared with respect to x",
    "Factorise the quadratic x^2 - 5x + 6 completely",
    "Find the sum of the interior angles of a hexagon",
    "Evaluate the integral of 1/x from 1 to e",
    "How many prime numbers are there between 10 and 30",
    "Simplify the expression (a + b)^2 - (a - b)^2",
    "What is the probability of rolling two sixes with two fair dice",
]


def iso(dt: datetime) -> str:
    return dt.isoformat()


def exam_body(now: datetime, start_in_minutes: int = 60, duration: int = 30) -> dict:
    return {
        "title": "Mid-term Mathematics",
        "subject": "Mathematics",
        "instructions": "Answer all questions.",
        "duration_minutes": duration,
        "start_at": iso(now + timedelta(minutes=start_in_minutes)),
        "end_at": iso(now + timedelta(minutes=start_in_minutes + 90)),
    }
