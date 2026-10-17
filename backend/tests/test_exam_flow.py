"""End-to-end exam lifecycle: vault -> blueprint -> generate -> sealed -> release ->
attempt -> submit -> close -> results, with the time-lock and audit chain checked."""

import json

import pytest

from app.models import Exam, ExamStatus, Role
from app.services.content import PaperNotReleased, open_paper
from tests.helpers import STEMS, approved_question, exam_body


@pytest.fixture()
def world(client, make_user, login, clock):
    admin = make_user(Role.ADMIN)
    author_h = login(make_user(Role.AUTHOR))
    reviewer_h = login(make_user(Role.REVIEWER))
    c1, c2 = make_user(Role.CANDIDATE), make_user(Role.CANDIDATE)
    qids = [
        approved_question(
            client,
            author_h,
            reviewer_h,
            stem,
            topic="Algebra" if i < 5 else "Geometry",
            difficulty="easy" if i % 2 == 0 else "medium",
        )
        for i, stem in enumerate(STEMS)
    ]
    return {
        "admin_h": login(admin),
        "c1": c1,
        "c1_h": login(c1),
        "c2": c2,
        "c2_h": login(c2),
        "author_h": author_h,
        "qids": qids,
    }


def _ready_exam(client, w, clock) -> int:
    h = w["admin_h"]
    r = client.post("/exams", json=exam_body(clock.now), headers=h)
    assert r.status_code == 201, r.text
    eid = r.json()["id"]
    blueprint = [
        {"topic": "Algebra", "difficulty": "easy", "count": 2},
        {"topic": "Algebra", "difficulty": "medium", "count": 1},
        {"topic": "Geometry", "difficulty": "medium", "count": 1},
    ]
    assert client.put(f"/exams/{eid}/blueprint", json=blueprint, headers=h).status_code == 200
    r = client.post(f"/exams/{eid}/generate", headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["exam"]["status"] == "sealed"
    assert len(r.json()["manifest"]) == 4
    r = client.post(
        f"/exams/{eid}/candidates", json={"candidate_ids": [w["c1"].id, w["c2"].id]}, headers=h
    )
    assert r.status_code == 200, r.text
    return eid


def test_full_lifecycle(client, db, world, clock):
    w = world
    eid = _ready_exam(client, w, clock)

    # --- before release: sealed for everyone ---
    exam = db.get(Exam, eid)
    with pytest.raises(PaperNotReleased):
        open_paper(exam, clock.now)
    listing = client.get("/candidate/exams", headers=w["c1_h"]).json()
    assert listing[0]["status"] == "draft"  # candidates can't tell a paper exists
    assert client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"]).status_code == 409
    # Manifest has no content.
    manifest = client.get(f"/exams/{eid}/manifest", headers=w["admin_h"]).json()
    assert all(set(m) == {"question_id", "topic", "difficulty", "marks"} for m in manifest)

    # --- release ---
    clock.advance(minutes=60)
    r = client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"])
    assert r.status_code == 200, r.text
    attempt = r.json()
    assert attempt["remaining_seconds"] == 30 * 60
    assert len(attempt["questions"]) == 4
    assert all("correct_option" not in q for q in attempt["questions"])
    db.expire_all()
    assert db.get(Exam, eid).status == ExamStatus.LIVE

    # Resume returns the same attempt and does not reset the timer.
    clock.advance(minutes=5)
    again = client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"]).json()
    assert again["attempt_id"] == attempt["attempt_id"]
    assert again["remaining_seconds"] == 25 * 60

    # --- auto-save; validate answers ---
    aid = attempt["attempt_id"]
    q0, q1 = attempt["questions"][0]["question_id"], attempt["questions"][1]["question_id"]
    url = f"/candidate/attempts/{aid}/answers"
    assert (
        client.put(url, json={"answers": {str(q0): 1}}, headers=w["c1_h"]).json()["answered"] == 1
    )
    assert (
        client.put(url, json={"answers": {str(q1): 0}}, headers=w["c1_h"]).json()["answered"] == 2
    )
    assert client.put(url, json={"answers": {"99999": 0}}, headers=w["c1_h"]).status_code == 422
    assert client.put(url, json={"answers": {str(q0): 9}}, headers=w["c1_h"]).status_code == 422
    # Another candidate can't see or write this attempt.
    assert client.get(f"/candidate/attempts/{aid}", headers=w["c2_h"]).status_code == 404
    assert client.put(url, json={"answers": {str(q0): 0}}, headers=w["c2_h"]).status_code == 404

    # Live monitor sees one in progress.
    mon = client.get(f"/exams/{eid}/monitor", headers=w["admin_h"]).json()
    assert (mon["enrolled"], mon["in_progress"], mon["not_started"]) == (2, 1, 1)
    assert mon["attempts"][0]["answered"] == 2

    # --- submit is final ---
    receipt = client.post(f"/candidate/attempts/{aid}/submit", headers=w["c1_h"]).json()
    assert len(receipt["answers_sha256"]) == 64 and not receipt["auto_submitted"]
    assert client.put(url, json={"answers": {str(q0): 2}}, headers=w["c1_h"]).status_code == 409
    again = client.post(f"/candidate/attempts/{aid}/submit", headers=w["c1_h"]).json()
    assert again == receipt
    assert client.get(f"/candidate/attempts/{aid}", headers=w["c1_h"]).json()["questions"] == []

    # --- candidate 2 starts but runs out of time: auto-submitted at the deadline ---
    a2 = client.post(f"/candidate/exams/{eid}/start", headers=w["c2_h"]).json()
    client.put(
        f"/candidate/attempts/{a2['attempt_id']}/answers",
        json={"answers": {str(q0): 1}},
        headers=w["c2_h"],
    )
    clock.advance(minutes=31)
    late = client.put(
        f"/candidate/attempts/{a2['attempt_id']}/answers",
        json={"answers": {str(q1): 1}},
        headers=w["c2_h"],
    )
    assert late.status_code == 409

    # --- results only after close ---
    assert client.get(f"/exams/{eid}/results", headers=w["admin_h"]).status_code == 409
    clock.advance(minutes=60)
    res = client.get(f"/exams/{eid}/results", headers=w["admin_h"]).json()
    assert res["candidates"] == 2 and res["total_marks"] == 4
    by_cand = {a["candidate_id"]: a for a in res["attempts"]}
    assert by_cand[w["c2"].id]["auto_submitted"] is True
    assert by_cand[w["c2"].id]["score"] >= 0
    assert len(res["per_question"]) == 4

    # --- the whole story is in an intact audit chain ---
    actions = [e["action"] for e in client.get("/audit?limit=500", headers=w["admin_h"]).json()]
    for expected in (
        "question.approved",
        "paper.generated",
        "paper.released",
        "attempt.started",
        "attempt.submitted",
        "attempt.auto_submitted",
        "exam.closed",
    ):
        assert expected in actions, expected
    assert client.get("/audit/verify", headers=w["admin_h"]).json()["valid"] is True


def test_scoring_matches_answer_key(client, db, world, clock):
    w = world
    eid = _ready_exam(client, w, clock)
    clock.advance(minutes=60)
    attempt = client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"]).json()
    # Helper questions all have correct_option == 1: answer 3 right, 1 wrong.
    qs = [q["question_id"] for q in attempt["questions"]]
    answers = {str(q): 1 for q in qs[:3]} | {str(qs[3]): 0}
    client.put(
        f"/candidate/attempts/{attempt['attempt_id']}/answers",
        json={"answers": answers},
        headers=w["c1_h"],
    )
    client.post(f"/candidate/attempts/{attempt['attempt_id']}/submit", headers=w["c1_h"])
    clock.advance(minutes=120)
    res = client.get(f"/exams/{eid}/results", headers=w["admin_h"]).json()
    assert res["attempts"][0]["score"] == 3 and res["attempts"][0]["max_score"] == 4


def test_generation_reports_shortfall(client, world, clock):
    h = world["admin_h"]
    eid = client.post("/exams", json=exam_body(clock.now), headers=h).json()["id"]
    client.put(
        f"/exams/{eid}/blueprint",
        json=[{"topic": "Geometry", "difficulty": "hard", "count": 3}],
        headers=h,
    )
    r = client.post(f"/exams/{eid}/generate", headers=h)
    assert r.status_code == 422
    assert r.json()["detail"]["shortfalls"][0]["available"] == 0


def test_editing_sealed_exam_blueprint_discards_paper(client, world, clock):
    w = world
    eid = _ready_exam(client, w, clock)
    r = client.put(
        f"/exams/{eid}/blueprint",
        json=[{"topic": "Algebra", "difficulty": "easy", "count": 1}],
        headers=w["admin_h"],
    )
    assert r.json()["status"] == "draft" and r.json()["paper_sha256"] is None


def test_live_exam_cannot_be_regenerated_or_edited(client, world, clock):
    w = world
    eid = _ready_exam(client, w, clock)
    clock.advance(minutes=61)
    assert client.post(f"/exams/{eid}/generate", headers=w["admin_h"]).status_code == 409
    assert (
        client.patch(f"/exams/{eid}", json={"title": "x"}, headers=w["admin_h"]).status_code == 409
    )


def test_unenrolled_candidate_cannot_see_exam(client, world, make_user, login, clock):
    w = world
    eid = _ready_exam(client, w, clock)
    outsider_h = login(make_user(Role.CANDIDATE))
    clock.advance(minutes=61)
    assert client.get("/candidate/exams", headers=outsider_h).json() == []
    assert client.post(f"/candidate/exams/{eid}/start", headers=outsider_h).status_code == 404


def test_monitor_websocket(client, world, clock):
    w = world
    eid = _ready_exam(client, w, clock)
    token = w["admin_h"]["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/exams/{eid}/monitor") as ws:
        ws.send_text(json.dumps({"token": token}))
        snap = ws.receive_json()
        assert snap["exam_id"] == eid and snap["enrolled"] == 2


def test_monitor_websocket_rejects_non_admin(client, world, clock):
    from starlette.websockets import WebSocketDisconnect

    w = world
    eid = _ready_exam(client, w, clock)
    token = w["c1_h"]["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/exams/{eid}/monitor") as ws:
        ws.send_text(json.dumps({"token": token}))
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_scheduler_tick_releases_and_closes(client, db, world, clock):
    from app.services.lifecycle import advance_all

    w = world
    eid = _ready_exam(client, w, clock)
    advance_all(db, clock.now)
    assert db.get(Exam, eid).status == ExamStatus.SEALED
    clock.advance(minutes=60)
    advance_all(db, clock.now)
    db.expire_all()
    db.expire_all()
    assert db.get(Exam, eid).status == ExamStatus.LIVE
    clock.advance(minutes=90)
    advance_all(db, clock.now)
    db.expire_all()
    assert db.get(Exam, eid).status == ExamStatus.CLOSED


# ---------- time-lock edge cases (Phase 5) ----------


def test_paper_opens_exactly_at_start_not_a_second_before(client, db, world, clock):
    from datetime import timedelta

    w = world
    eid = _ready_exam(client, w, clock)
    start = db.get(Exam, eid).start_at
    clock.now = start - timedelta(seconds=1)
    r = client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"])
    assert r.status_code == 409 and "questions" not in r.text
    with pytest.raises(PaperNotReleased):
        open_paper(db.get(Exam, eid), clock.now)
    clock.now = start
    r = client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"])
    assert r.status_code == 200 and len(r.json()["questions"]) == 4


def test_no_route_leaks_sealed_content_before_release(client, db, world, clock):
    """Before release, nothing an admin, author or candidate can fetch contains a stem."""
    w = world
    eid = _ready_exam(client, w, clock)
    stems = [s[:20] for s in STEMS]
    responses = [
        client.get(f"/exams/{eid}", headers=w["admin_h"]),
        client.get(f"/exams/{eid}/manifest", headers=w["admin_h"]),
        client.get(f"/exams/{eid}/monitor", headers=w["admin_h"]),
        client.get("/bank", headers=w["admin_h"]),
        client.get("/questions/mine", headers=w["author_h"]),
        client.get("/candidate/exams", headers=w["c1_h"]),
        client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"]),
    ] + [client.get(f"/questions/{q}", headers=w["author_h"]) for q in w["qids"]]
    for r in responses:
        assert not any(s in r.text for s in stems), r.request.url


def test_sealed_blobs_are_bound_to_their_record(client, db, world, clock):
    """Copying one exam's sealed paper onto another exam doesn't decrypt (AES-GCM AAD)."""
    from app.services.vault import VaultError

    w = world
    a, b = _ready_exam(client, w, clock), _ready_exam(client, w, clock)
    ea, eb = db.get(Exam, a), db.get(Exam, b)
    eb.paper_ciphertext, eb.paper_nonce, eb.paper_wrapped_key = (
        ea.paper_ciphertext,
        ea.paper_nonce,
        ea.paper_wrapped_key,
    )
    clock.advance(minutes=61)
    assert open_paper(ea, clock.now)["questions"]
    with pytest.raises(VaultError):
        open_paper(eb, clock.now)


# ---------- proctoring ----------


def _live_attempt(client, w, clock) -> tuple[int, int]:
    eid = _ready_exam(client, w, clock)
    clock.advance(minutes=60)
    r = client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"])
    assert r.status_code == 200, r.text
    assert r.json()["violations"] == 0 and r.json()["max_violations"] == 3
    return eid, r.json()["attempt_id"]


def test_violations_counted_and_limit_auto_submits(client, world, clock):
    w = world
    eid, aid = _live_attempt(client, w, clock)
    url = f"/candidate/attempts/{aid}/violations"
    qid = client.get(f"/candidate/attempts/{aid}", headers=w["c1_h"]).json()["questions"][0]
    client.put(
        f"/candidate/attempts/{aid}/answers",
        json={"answers": {str(qid["question_id"]): 1}},
        headers=w["c1_h"],
    )

    r = client.post(url, json={"kind": "window_blur"}, headers=w["c1_h"])
    assert r.json() == {"violations": 1, "max_violations": 3, "counted": True, "submitted": False}
    # Alt+Tab fires blur and visibilitychange together: one violation, not two.
    r = client.post(url, json={"kind": "tab_hidden"}, headers=w["c1_h"])
    assert r.json()["violations"] == 1 and r.json()["counted"] is False

    clock.advance(seconds=10)
    assert client.post(url, json={"kind": "fullscreen_exit"}, headers=w["c1_h"]).json()[
        "violations"
    ] == 2
    clock.advance(seconds=10)
    r = client.post(url, json={"kind": "tab_hidden"}, headers=w["c1_h"])
    assert r.json() == {"violations": 3, "max_violations": 3, "counted": True, "submitted": True}

    receipt = client.post(f"/candidate/attempts/{aid}/submit", headers=w["c1_h"]).json()
    assert receipt["auto_submitted"] is True and receipt["violations"] == 3
    # Nothing more can be saved or reported once submitted.
    assert client.post(url, json={"kind": "tab_hidden"}, headers=w["c1_h"]).status_code == 409

    monitor = client.get(f"/exams/{eid}/monitor", headers=w["admin_h"]).json()
    assert monitor["attempts"][0]["violations"] == 3
    clock.advance(minutes=120)
    res = client.get(f"/exams/{eid}/results", headers=w["admin_h"]).json()
    row = res["attempts"][0]
    assert row["violations"] == 3 and row["score"] == 1  # the saved answer still counts
    actions = [e["action"] for e in client.get("/audit", headers=w["admin_h"]).json()]
    assert actions.count("attempt.violation") == 3 and "attempt.violation_limit" in actions


def test_violation_limit_zero_only_records(client, world, clock, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "proctor_max_violations", 0)
    w = world
    _, aid = _live_attempt_no_limit(client, w, clock)
    for _ in range(5):
        clock.advance(seconds=10)
        r = client.post(
            f"/candidate/attempts/{aid}/violations", json={"kind": "tab_hidden"}, headers=w["c1_h"]
        )
        assert r.json()["submitted"] is False
    assert r.json()["violations"] == 5


def _live_attempt_no_limit(client, w, clock) -> tuple[int, int]:
    eid = _ready_exam(client, w, clock)
    clock.advance(minutes=60)
    r = client.post(f"/candidate/exams/{eid}/start", headers=w["c1_h"])
    return eid, r.json()["attempt_id"]


def test_violations_only_for_own_attempt(client, world, clock):
    w = world
    _, aid = _live_attempt(client, w, clock)
    r = client.post(
        f"/candidate/attempts/{aid}/violations", json={"kind": "tab_hidden"}, headers=w["c2_h"]
    )
    assert r.status_code == 404
    r = client.post(
        f"/candidate/attempts/{aid}/violations", json={"kind": "bogus"}, headers=w["c1_h"]
    )
    assert r.status_code == 422


JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100


def test_snapshot_upload_and_admin_view(client, world, clock):
    w = world
    eid, aid = _live_attempt(client, w, clock)
    attempt = client.get(f"/candidate/attempts/{aid}", headers=w["c1_h"]).json()
    assert attempt["media_required"] is True and attempt["snapshot_seconds"] == 20
    url = f"/candidate/attempts/{aid}/snapshot"
    h = w["c1_h"] | {"Content-Type": "image/jpeg"}
    assert client.put(url, content=b"not a jpeg", headers=h).status_code == 415
    assert client.put(url, content=JPEG + b"0" * 400_000, headers=h).status_code == 413
    assert client.put(url, content=JPEG, headers=w["c2_h"]).status_code == 404
    assert client.put(url, content=JPEG, headers=h).status_code == 204

    snap = f"/exams/{eid}/attempts/{aid}/snapshot"
    assert client.get(snap, headers=w["c1_h"]).status_code == 403
    r = client.get(snap, headers=w["admin_h"])
    assert r.status_code == 200 and r.content == JPEG and r.headers["content-type"] == "image/jpeg"
    monitor = client.get(f"/exams/{eid}/monitor", headers=w["admin_h"]).json()
    assert monitor["attempts"][0]["snapshot_at"] is not None


def test_noise_is_flagged_but_never_ends_the_attempt(client, world, clock):
    w = world
    eid, aid = _live_attempt(client, w, clock)
    for _ in range(5):
        r = client.post(
            f"/candidate/attempts/{aid}/violations", json={"kind": "noise"}, headers=w["c1_h"]
        )
        assert r.json()["submitted"] is False and r.json()["violations"] == 0
    monitor = client.get(f"/exams/{eid}/monitor", headers=w["admin_h"]).json()
    assert monitor["attempts"][0]["noise_flags"] == 5
    assert monitor["attempts"][0]["submitted_at"] is None
