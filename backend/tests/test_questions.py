from app.models import Question, Role, VaultItem
from app.services.content import open_question
from tests.helpers import approved_question, question_body

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


def _setup(make_user, login):
    author = make_user(Role.AUTHOR)
    return author, login(author), login(make_user(Role.REVIEWER)), login(make_user(Role.ADMIN))


def test_validation_rejects_bad_answer_index(client, make_user, login):
    _, author_h, _, _ = _setup(make_user, login)
    r = client.post("/questions", json=question_body("Q", correct_option=7), headers=author_h)
    assert r.status_code == 422
    r = client.post("/questions", json=question_body("Q", options=["A", "A"]), headers=author_h)
    assert r.status_code == 422


def test_draft_edit_submit_reject_resubmit_approve(client, db, make_user, login):
    _, author_h, reviewer_h, admin_h = _setup(make_user, login)
    r = client.post("/questions", json=question_body("What is 3 x 4?"), headers=author_h)
    qid = r.json()["id"]
    assert r.json()["status"] == "draft"

    # Reviewers only see submitted questions.
    assert client.get(f"/questions/{qid}", headers=reviewer_h).status_code == 404
    assert client.get("/reviews/queue", headers=reviewer_h).json() == []

    r = client.patch(f"/questions/{qid}", json={"stem": "What is 3 x 4 ?"}, headers=author_h)
    assert r.status_code == 200 and r.json()["stem"] == "What is 3 x 4 ?"
    assert client.post(f"/questions/{qid}/submit", headers=author_h).json()["status"] == "submitted"

    # Submitted questions are frozen for the author.
    assert client.patch(f"/questions/{qid}", json={"marks": 2}, headers=author_h).status_code == 409

    r = client.post(
        f"/reviews/{qid}/reject", json={"feedback": "Fix the spacing"}, headers=reviewer_h
    )
    assert r.json()["status"] == "rejected"
    assert (
        client.get(f"/questions/{qid}", headers=author_h).json()["review_feedback"]
        == "Fix the spacing"
    )

    client.patch(f"/questions/{qid}", json={"stem": "What is 3 x 4?"}, headers=author_h)
    client.post(f"/questions/{qid}/submit", headers=author_h)
    assert len(client.get("/reviews/queue", headers=reviewer_h).json()) == 1
    r = client.post(f"/reviews/{qid}/approve", headers=reviewer_h)
    assert r.status_code == 200 and r.json()["status"] == "approved"

    # Approved content is only in the vault.
    q = db.get(Question, qid)
    db.refresh(q)
    assert q.stem is None and q.options is None and q.correct_option is None
    item = db.get(VaultItem, qid)
    assert open_question(item)["stem"] == "What is 3 x 4?"
    assert open_question(item)["correct_option"] == 1

    # Nobody reads approved content through the API; admin gets metadata only.
    assert client.get(f"/questions/{qid}", headers=reviewer_h).status_code == 404
    admin_view = client.get(f"/questions/{qid}", headers=admin_h).json()
    assert "stem" not in admin_view and admin_view["status"] == "approved"
    assert [b["id"] for b in client.get("/bank", headers=admin_h).json()] == [qid]
    assert client.patch(f"/questions/{qid}", json={"marks": 2}, headers=author_h).status_code == 409


def test_authors_cannot_touch_each_others_questions(client, make_user, login):
    _, author_h, _, _ = _setup(make_user, login)
    other_h = login(make_user(Role.AUTHOR))
    qid = client.post("/questions", json=question_body("Mine"), headers=author_h).json()["id"]
    assert client.get(f"/questions/{qid}", headers=other_h).status_code == 404
    assert client.patch(f"/questions/{qid}", json={"marks": 3}, headers=other_h).status_code == 404
    assert client.post(f"/questions/{qid}/submit", headers=other_h).status_code == 404


def test_image_upload_is_sniffed_and_sealed(client, db, make_user, login):
    _, author_h, reviewer_h, _ = _setup(make_user, login)
    qid = client.post("/questions", json=question_body("See figure"), headers=author_h).json()["id"]
    bad = client.put(
        f"/questions/{qid}/image",
        files={"file": ("x.png", b"<svg onload=alert(1)>", "image/png")},
        headers=author_h,
    )
    assert bad.status_code == 415
    r = client.put(
        f"/questions/{qid}/image", files={"file": ("d.png", PNG, "image/png")}, headers=author_h
    )
    assert r.status_code == 200 and r.json()["has_image"]
    img = client.get(f"/questions/{qid}/image", headers=author_h)
    assert img.content == PNG and img.headers["content-type"] == "image/png"

    client.post(f"/questions/{qid}/submit", headers=author_h)
    client.post(f"/reviews/{qid}/approve", headers=reviewer_h)
    assert client.get(f"/questions/{qid}/image", headers=author_h).status_code == 404
    assert open_question(db.get(VaultItem, qid))["image"]["mime"] == "image/png"


def test_similarity_check_flags_near_duplicates(client, make_user, login):
    _, author_h, reviewer_h, _ = _setup(make_user, login)
    original = approved_question(
        client, author_h, reviewer_h, "Find the area of a circle with radius 7 cm"
    )
    approved_question(client, author_h, reviewer_h, "Name the largest planet in the solar system")
    r = client.post(
        "/questions",
        json=question_body("Find the area of a circle with radius 7 cm."),
        headers=author_h,
    )
    qid = r.json()["id"]
    client.post(f"/questions/{qid}/submit", headers=author_h)
    hits = client.get(f"/reviews/{qid}/similar", headers=reviewer_h).json()
    assert hits[0]["question_id"] == original
    assert hits[0]["similarity"] > 0.9
    assert hits[1]["similarity"] < 0.3
