"""Operator CLI: set-password."""

from types import SimpleNamespace

from app import cli
from app.models import Role

NEW = "Brand-New-77"


def _run(monkeypatch, db, typed, **kw):
    monkeypatch.setattr(cli, "SessionLocal", lambda: db)
    answers = iter(typed)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": next(answers))
    args = SimpleNamespace(email=kw.get("email"), domain=kw.get("domain"))
    return cli.set_password(args)


def _signs_in(client, email, password):
    r = client.post("/auth/login", data={"username": email, "password": password})
    return r.status_code == 200


def test_set_password_for_a_domain(client, db, make_user, monkeypatch):
    a = make_user(Role.AUTHOR, email="a@aegis-exam.com")
    c = make_user(Role.CANDIDATE, email="c@aegis-exam.com")
    other = make_user(Role.REVIEWER, email="r@example.com")
    assert _run(monkeypatch, db, [NEW, NEW], domain="@aegis-exam.com") == 0
    assert _signs_in(client, a.email, NEW) and _signs_in(client, c.email, NEW)
    assert not _signs_in(client, other.email, NEW)  # other domains untouched


def test_set_password_for_one_email(client, db, make_user, monkeypatch):
    a = make_user(Role.AUTHOR, email="one@aegis-exam.com")
    b = make_user(Role.AUTHOR, email="two@aegis-exam.com")
    assert _run(monkeypatch, db, [NEW, NEW], email="ONE@aegis-exam.com") == 0
    assert _signs_in(client, a.email, NEW)
    assert not _signs_in(client, b.email, NEW)


def test_set_password_refuses_bad_input(db, make_user, monkeypatch):
    make_user(Role.AUTHOR, email="x@aegis-exam.com")
    assert _run(monkeypatch, db, ["short", "short"], domain="aegis-exam.com") == 1
    assert _run(monkeypatch, db, [NEW, "different-1234"], domain="aegis-exam.com") == 1
    assert _run(monkeypatch, db, [NEW, NEW], domain="nowhere.example") == 1
    assert _run(monkeypatch, db, [NEW, NEW]) == 1  # neither --email nor --domain
