"""Email verification and Sign in with Google."""

from datetime import timedelta

import pytest

import app.api.auth as auth_api
from app.core.config import get_settings
from app.core.security import create_access_token, create_email_verification_token
from app.models import Role, User
from app.services.google_auth import GoogleTokenError

CSRF = {"X-AEGIS-CSRF": "1"}
NEW_PASSWORD = "Fresh-Pass-21"


@pytest.fixture()
def sent(monkeypatch):
    """Capture verification emails instead of sending them."""
    outbox = []
    monkeypatch.setattr(
        auth_api, "send_verification_email", lambda uid, email, name: outbox.append((uid, email))
    )
    return outbox


def _create(client, admin_h, email="new.reviewer@example.com"):
    body = {
        "email": email,
        "full_name": "New Reviewer",
        "password": NEW_PASSWORD,
        "role": "reviewer",
    }
    r = client.post("/users", json=body, headers=admin_h)
    assert r.status_code == 201, r.text
    return r.json()


def _login(client, email, password=NEW_PASSWORD, **kw):
    return client.post("/auth/login", data={"username": email, "password": password}, **kw)


# ---------- email verification ----------


def test_new_account_must_verify_before_password_sign_in(client, make_user, login, sent):
    admin_h = login(make_user(Role.ADMIN))
    user = _create(client, admin_h)
    assert user["email_verified"] is False
    assert sent == [(user["id"], "new.reviewer@example.com")]

    r = _login(client, user["email"])
    assert r.status_code == 403 and "verify your email" in r.json()["detail"]

    token = create_email_verification_token(user["id"], user["email"])
    r = client.post("/auth/verify-email", json={"token": token})
    assert r.status_code == 200 and r.json()["verified"] is True
    assert _login(client, user["email"]).status_code == 200
    # Verifying again is harmless.
    assert client.post("/auth/verify-email", json={"token": token}).status_code == 200


def test_wrong_password_on_unverified_account_still_says_incorrect(client, make_user, login, sent):
    admin_h = login(make_user(Role.ADMIN))
    user = _create(client, admin_h)
    r = _login(client, user["email"], password="not-the-password")
    assert r.status_code == 401  # reveals nothing about verification to a guesser


@pytest.mark.parametrize("bad", ["not-a-token-at-all", "x" * 40])
def test_invalid_verification_token(client, bad):
    r = client.post("/auth/verify-email", json={"token": bad})
    assert r.status_code == 400


def test_expired_and_mismatched_tokens_are_refused(client, make_user, login, sent, monkeypatch):
    admin_h = login(make_user(Role.ADMIN))
    user = _create(client, admin_h)
    # A token for a different address is refused.
    other = create_email_verification_token(user["id"], "someone.else@example.com")
    assert client.post("/auth/verify-email", json={"token": other}).status_code == 400
    # An expired token is refused.
    monkeypatch.setattr(get_settings(), "email_verify_hours", -1)
    expired = create_email_verification_token(user["id"], user["email"])
    assert client.post("/auth/verify-email", json={"token": expired}).status_code == 400


def test_tokens_are_not_interchangeable(client, make_user, db):
    user = make_user(Role.ADMIN)
    verify_token = create_email_verification_token(user.id, user.email)
    # A verification token is not a session.
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {verify_token}"})
    assert r.status_code == 401
    # A session token is not a verification token.
    session = create_access_token(user.id, user.role.value)
    assert client.post("/auth/verify-email", json={"token": session}).status_code == 400


def test_resend_is_generic_and_rate_limited(client, make_user, login, sent):
    admin_h = login(make_user(Role.ADMIN))
    user = _create(client, admin_h)
    sent.clear()
    # Unknown, already verified and unverified addresses all get the same answer.
    verified = make_user(Role.AUTHOR, email="verified.author@example.com")
    for email in ["nobody@example.com", verified.email, user["email"]]:
        r = client.post("/auth/resend-verification", json={"email": email})
        assert r.status_code == 202 and r.json() == {"sent": True}
    assert sent == [(user["id"], user["email"])]  # only the unverified account got mail
    for _ in range(2):
        client.post("/auth/resend-verification", json={"email": user["email"]})
    r = client.post("/auth/resend-verification", json={"email": user["email"]})
    assert r.status_code == 429


def test_admin_can_resend_verification(client, make_user, login, sent):
    admin_h = login(make_user(Role.ADMIN))
    user = _create(client, admin_h)
    sent.clear()
    assert (
        client.post(f"/users/{user['id']}/resend-verification", headers=admin_h).status_code == 202
    )
    assert sent == [(user["id"], user["email"])]
    verified = make_user(Role.CANDIDATE)
    r = client.post(f"/users/{verified.id}/resend-verification", headers=admin_h)
    assert r.status_code == 409
    author_h = login(make_user(Role.AUTHOR))
    assert (
        client.post(f"/users/{user['id']}/resend-verification", headers=author_h).status_code == 403
    )


def test_verification_link_points_at_the_web_app(monkeypatch):
    from app.services.verification import verification_link

    monkeypatch.setattr(get_settings(), "app_base_url", "https://aegis.example.com/")
    link = verification_link(7, "a@example.com")
    assert link.startswith("https://aegis.example.com/verify-email?token=")


# ---------- Sign in with Google ----------


@pytest.fixture()
def google(monkeypatch):
    """Google configured, with the ID-token check replaced by a lookup table."""
    monkeypatch.setattr(
        get_settings(), "google_client_id", "test-client.apps.googleusercontent.com"
    )
    tokens = {}

    def fake_verify(credential, client_id):
        assert client_id == "test-client.apps.googleusercontent.com"
        if credential not in tokens:
            raise GoogleTokenError("bad token")
        return tokens[credential]

    monkeypatch.setattr(auth_api, "verify_google_id_token", fake_verify)
    return tokens


def test_auth_config_exposes_client_id(client, google):
    assert client.get("/auth/config").json() == {
        "google_client_id": "test-client.apps.googleusercontent.com"
    }


def test_google_not_configured(client):
    assert client.get("/auth/config").json() == {"google_client_id": None}
    r = client.post("/auth/google", json={"credential": "x" * 40})
    assert r.status_code == 503


def test_google_signs_in_existing_account_with_its_role(client, make_user, google):
    user = make_user(Role.REVIEWER, email="reviewer.g@example.com")
    google["good-google-token-" + "x" * 20] = "reviewer.g@example.com"
    r = client.post(
        "/auth/google", json={"credential": "good-google-token-" + "x" * 20}, headers=CSRF
    )
    assert r.status_code == 200 and r.json()["role"] == "reviewer"
    assert r.json()["access_token"] is None  # web app gets the httpOnly cookie
    me = client.get("/auth/me")
    assert me.status_code == 200 and me.json()["id"] == user.id


def test_google_marks_unverified_account_verified(client, make_user, login, sent, google, db):
    admin_h = login(make_user(Role.ADMIN))
    user = _create(client, admin_h, email="cand.g@example.com")
    google["cand-google-token-" + "x" * 20] = "cand.g@example.com"
    r = client.post("/auth/google", json={"credential": "cand-google-token-" + "x" * 20})
    assert r.status_code == 200
    db.expire_all()
    assert db.get(User, user["id"]).email_verified_at is not None
    assert _login(client, "cand.g@example.com").status_code == 200  # password works now too


def test_google_refuses_unknown_and_inactive_accounts(client, make_user, google, db):
    google["unknown-token-" + "x" * 20] = "stranger@gmail.com"
    r = client.post("/auth/google", json={"credential": "unknown-token-" + "x" * 20})
    assert r.status_code == 403 and "administrator" in r.json()["detail"]

    user = make_user(Role.CANDIDATE, email="gone@example.com")
    user.is_active = False
    db.commit()
    google["inactive-token-" + "x" * 20] = "gone@example.com"
    assert (
        client.post("/auth/google", json={"credential": "inactive-token-" + "x" * 20}).status_code
        == 403
    )


def test_google_rejects_unverifiable_tokens(client, google):
    r = client.post("/auth/google", json={"credential": "forged-token-" + "x" * 20})
    assert r.status_code == 401


def test_real_verifier_rejects_garbage():
    from app.services.google_auth import verify_google_id_token

    with pytest.raises(GoogleTokenError):
        verify_google_id_token("not.a.jwt", "client")


def test_existing_users_are_verified_by_migration_rule():
    # The migration marks every pre-existing account verified (created_at copied); new accounts
    # start unverified. This guards the model default the endpoints rely on.
    u = User(email="x@example.com", full_name="X", password_hash="h", role=Role.CANDIDATE)
    assert u.email_verified is False
    u.email_verified_at = u.created_at or __import__("datetime").datetime(2026, 1, 1)
    assert u.email_verified is True
    assert timedelta(0) == timedelta(0)


def test_admin_can_mark_an_account_verified(client, make_user, login, sent):
    admin_h = login(make_user(Role.ADMIN))
    user = _create(client, admin_h)
    r = client.post(f"/users/{user['id']}/mark-verified", headers=admin_h)
    assert r.status_code == 200 and r.json()["email_verified"] is True
    assert _login(client, user["email"]).status_code == 200
    author_h = login(make_user(Role.AUTHOR))
    assert client.post(f"/users/{user['id']}/mark-verified", headers=author_h).status_code == 403


def test_cli_created_admin_can_sign_in(client, db, monkeypatch):
    from app import cli

    monkeypatch.setattr(cli, "SessionLocal", lambda: db)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": "Cli-Admin-Pass9")
    args = type(
        "A", (), {"email": "first.admin@example.com", "name": "First Admin", "role": "admin"}
    )()
    assert cli.create_user(args) == 0
    assert _login(client, "first.admin@example.com", password="Cli-Admin-Pass9").status_code == 200
