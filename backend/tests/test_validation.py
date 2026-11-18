"""Input validation: every request body and filter rejects malformed or hostile input."""

from datetime import timedelta

import pytest

from app.core.timeutil import utcnow
from app.models import Role
from tests.helpers import exam_body, question_body

RLO = chr(0x202E)  # right-to-left override: displays text reversed


def _admin(make_user, login):
    return login(make_user(Role.ADMIN))


def _user(**kw):
    body = {
        "email": "new.user@example.com",
        "full_name": "New User",
        "password": "strong-Pass-42",
        "role": "author",
    }
    body.update(kw)
    return body


# ---------- names and emails ----------


@pytest.mark.parametrize(
    "name",
    ["   ", "", "A", f"Admin{RLO}nimda", "Null\x00Byte", "Two\nLines", "Tab\tName", "x" * 101],
)
def test_names_reject_blank_short_control_and_multiline(client, make_user, login, name):
    r = client.post("/users", json=_user(full_name=name), headers=_admin(make_user, login))
    assert r.status_code == 422, name


def test_names_are_tidied(client, make_user, login):
    r = client.post(
        "/users", json=_user(full_name="  Asha    Rao  "), headers=_admin(make_user, login)
    )
    assert r.status_code == 201 and r.json()["full_name"] == "Asha Rao"


def test_email_is_normalised_and_validated(client, make_user, login):
    admin_h = _admin(make_user, login)
    r = client.post("/users", json=_user(email="Mixed.Case@Example.COM"), headers=admin_h)
    assert r.status_code == 201 and r.json()["email"] == "mixed.case@example.com"
    for bad in [
        "not-an-email",
        "a@b",
        "two@@example.com",
        "sp ace@example.com",
        f"{'x' * 250}@example.com",
    ]:
        assert client.post("/users", json=_user(email=bad), headers=admin_h).status_code == 422, bad


def test_role_cannot_be_changed_through_a_profile_update(client, make_user, login):
    admin_h = _admin(make_user, login)
    target = make_user(Role.AUTHOR)
    r = client.patch(f"/users/{target.id}", json={"role": "admin"}, headers=admin_h)
    assert r.status_code == 200 and r.json()["role"] == "author"


# ---------- passwords ----------


@pytest.mark.parametrize(
    "password",
    [
        "short1",  # under 10 characters
        "Abcdefgh-1234567",  # 16 characters: over the 15 limit
        "aaaaabbbbb",  # fewer than 5 different characters
        "new.user-rocks!",  # contains the email's local part
        "with\x00null-byte",
        "line\nbreak-pw1",
        " leading-pass9",  # leading space
        "trailing-pass9 ",  # trailing space
    ],
)
def test_weak_or_invalid_passwords_are_rejected(client, make_user, login, password):
    r = client.post("/users", json=_user(password=password), headers=_admin(make_user, login))
    assert r.status_code == 422, repr(password)


def test_password_equal_to_name_is_rejected(client, make_user, login):
    r = client.post(
        "/users",
        json=_user(full_name="Bhaskar Iyengar", password="bhaskar iyengar"),
        headers=_admin(make_user, login),
    )
    assert r.status_code == 422


def test_password_keeps_inner_spaces(client, make_user, login):
    r = client.post(
        "/users", json=_user(password="spaced  pass9"), headers=_admin(make_user, login)
    )
    assert r.status_code == 201
    ok = client.post(
        "/auth/login", data={"username": "new.user@example.com", "password": "spaced  pass9"}
    )
    assert ok.status_code == 200


def test_simple_numeric_password_is_allowed(client, make_user, login):
    # The demo accounts use 1234567890: ten different characters within the 10-15 rule.
    r = client.post("/users", json=_user(password="1234567890"), headers=_admin(make_user, login))
    assert r.status_code == 201


def test_password_length_is_10_to_15(client, make_user, login):
    admin_h = _admin(make_user, login)
    assert (
        client.post("/users", json=_user(password="Abcdefgh-123456"), headers=admin_h).status_code
        == 201
    )
    long_one = _user(email="other@example.com", password="Abcdefgh-1234567")
    assert client.post("/users", json=long_one, headers=admin_h).status_code == 422
    short_one = _user(email="third@example.com", password="Abc-12345")
    assert client.post("/users", json=short_one, headers=admin_h).status_code == 422


def test_validation_errors_do_not_echo_input(client, make_user, login):
    secret = "aaaaabbbbb"
    r = client.post("/users", json=_user(password=secret), headers=_admin(make_user, login))
    assert r.status_code == 422
    assert secret not in r.text




# ---------- questions ----------


def test_question_rules(client, make_user, login):
    author_h = login(make_user(Role.AUTHOR))

    def post(**kw):
        body = {**question_body("What is 2 + 2?"), **kw}
        return client.post("/questions", json=body, headers=author_h)

    assert post(options=["Newton", "newton "]).status_code == 422  # same answer twice
    assert post(options=["A", "x" * 501]).status_code == 422  # option too long
    assert post(options=["A", "   "]).status_code == 422  # blank option
    assert post(options=["A"]).status_code == 422  # fewer than 2
    assert post(options=[str(i) for i in range(9)]).status_code == 422  # more than 8
    assert post(topic="Line\nbreak").status_code == 422
    assert post(topic="A").status_code == 422  # under 2 characters
    assert post(subject=f"Phys{RLO}ics").status_code == 422
    assert post(stem="   ").status_code == 422
    assert post(stem="Too short").status_code == 422  # under 10 characters
    assert post(stem="x" * 2001).status_code == 422
    assert post(marks=0).status_code == 422
    assert post(marks=101).status_code == 422
    assert post(correct_option=8).status_code == 422
    # Multi-line stems and explanations are allowed; a blank explanation is stored as none.
    r = post(stem="Line one\nLine two", explanation="   ")
    assert r.status_code == 201 and r.json()["explanation"] is None


def test_question_edit_is_revalidated(client, make_user, login):
    author_h = login(make_user(Role.AUTHOR))
    qid = client.post("/questions", json=question_body("What is 2 + 2?"), headers=author_h).json()[
        "id"
    ]
    r = client.patch(f"/questions/{qid}", json={"correct_option": 5}, headers=author_h)
    assert r.status_code == 422
    # A status can't be set by editing; it is ignored.
    r = client.patch(f"/questions/{qid}", json={"status": "approved"}, headers=author_h)
    assert r.status_code == 200 and r.json()["status"] == "draft"


def test_review_feedback_is_validated(client, make_user, login):
    author_h = login(make_user(Role.AUTHOR))
    reviewer_h = login(make_user(Role.REVIEWER))
    qid = client.post("/questions", json=question_body("What is 2 + 2?"), headers=author_h).json()[
        "id"
    ]
    client.post(f"/questions/{qid}/submit", headers=author_h)
    for bad in ["  ", "ok", "Bad\x07bell", "x" * 501]:
        r = client.post(f"/reviews/{qid}/reject", json={"feedback": bad}, headers=reviewer_h)
        assert r.status_code == 422, bad
    r = client.post(f"/reviews/{qid}/approve", json={"feedback": "y" * 501}, headers=reviewer_h)
    assert r.status_code == 422


# ---------- exams ----------


def test_exam_rules(client, make_user, login):
    admin_h = _admin(make_user, login)
    now = utcnow()

    def post(**kw):
        return client.post("/exams", json={**exam_body(now), **kw}, headers=admin_h)

    assert post(end_at=(now + timedelta(days=8)).isoformat()).status_code == 422  # > 7 days
    assert post(title="Title\nwith a break").status_code == 422
    assert post(title="Quiz").status_code == 422  # under 5 characters
    assert post(title="x" * 121).status_code == 422
    assert post(subject="M").status_code == 422
    assert post(instructions="x" * 2001).status_code == 422
    assert post(duration_minutes=0).status_code == 422
    assert post(duration_minutes=24 * 60 + 1).status_code == 422

    exam_id = post().json()["id"]
    far = {"end_at": (now + timedelta(days=9)).isoformat()}
    assert client.patch(f"/exams/{exam_id}", json=far, headers=admin_h).status_code == 422
    assert (
        client.patch(f"/exams/{exam_id}", json={"title": "Quiz"}, headers=admin_h).status_code
        == 422
    )


def test_blueprint_rules(client, make_user, login):
    admin_h = _admin(make_user, login)
    exam_id = client.post("/exams", json=exam_body(utcnow()), headers=admin_h).json()["id"]
    url = f"/exams/{exam_id}/blueprint"
    row = {"topic": "Algebra", "difficulty": "easy", "count": 2, "marks": None}

    dup = [row, {**row, "topic": " algebra "}]
    assert client.put(url, json=dup, headers=admin_h).status_code == 422
    too_many_rows = [{**row, "topic": f"Topic {i}"} for i in range(101)]
    assert client.put(url, json=too_many_rows, headers=admin_h).status_code == 422
    too_many_questions = [{**row, "topic": f"T{i}", "count": 500} for i in range(3)]
    assert client.put(url, json=too_many_questions, headers=admin_h).status_code == 422
    assert client.put(url, json=[{**row, "count": 0}], headers=admin_h).status_code == 422
    assert client.put(url, json=[{**row, "marks": 0}], headers=admin_h).status_code == 422
    assert (
        client.put(url, json=[row, {**row, "difficulty": "hard"}], headers=admin_h).status_code
        == 200
    )


def test_enrolment_ids_must_be_positive(client, make_user, login):
    admin_h = _admin(make_user, login)
    exam_id = client.post("/exams", json=exam_body(utcnow()), headers=admin_h).json()["id"]
    for ids in [[0], [-5], [2**31], []]:
        r = client.post(
            f"/exams/{exam_id}/candidates", json={"candidate_ids": ids}, headers=admin_h
        )
        assert r.status_code == 422, ids


def test_saved_answers_shape():
    from pydantic import ValidationError

    from app.schemas import SaveAnswers

    assert SaveAnswers(answers={"12": 0, "13": None}).answers == {"12": 0, "13": None}
    for bad in [{"abc": 0}, {"0": 1}, {"-1": 1}, {"12": 8}, {"12": -1}, {"1" * 11: 0}]:
        with pytest.raises(ValidationError):
            SaveAnswers(answers=bad)


# ---------- filters ----------


@pytest.mark.parametrize(
    "query",
    [
        "action=paper.released' OR '1'='1",
        "action=" + "a" * 101,
        "entity_type=exam;DROP",
        "actor_id=0",
        "before_id=-1",
        "limit=501",
    ],
)
def test_audit_filters_are_validated(client, make_user, login, query):
    r = client.get(f"/audit?{query}", headers=_admin(make_user, login))
    assert r.status_code == 422, query
