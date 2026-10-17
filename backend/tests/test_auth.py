import pytest

from app.models import Role


def test_login_and_me(client, make_user, login):
    user = make_user(Role.AUTHOR)
    h = login(user)
    r = client.get("/auth/me", headers=h)
    assert r.status_code == 200
    assert r.json()["role"] == "author"
    assert "password_hash" not in r.json()


def test_bad_password_and_unknown_email_look_the_same(client, make_user):
    user = make_user(Role.ADMIN)
    bad = client.post("/auth/login", data={"username": user.email, "password": "wrong-pass-123"})
    unknown = client.post("/auth/login", data={"username": "x@y.test", "password": "whatever-123"})
    assert bad.status_code == unknown.status_code == 401
    assert bad.json() == unknown.json()


def test_missing_or_garbage_token_is_401(client):
    assert client.get("/auth/me").status_code == 401
    assert client.get("/auth/me", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_deactivated_user_loses_access(client, make_user, login):
    admin_h = login(make_user(Role.ADMIN))
    cand = make_user(Role.CANDIDATE)
    cand_h = login(cand)
    r = client.patch(f"/users/{cand.id}", json={"is_active": False}, headers=admin_h)
    assert r.status_code == 200
    assert client.get("/auth/me", headers=cand_h).status_code == 401


def test_admin_creates_users_others_cannot(client, make_user, login):
    admin_h = login(make_user(Role.ADMIN))
    body = {
        "email": "New.Reviewer@Example.com",
        "full_name": "New Reviewer",
        "password": "long-enough",
        "role": "reviewer",
    }
    r = client.post("/users", json=body, headers=admin_h)
    assert r.status_code == 201, r.text
    assert r.json()["email"] == "new.reviewer@example.com"
    assert client.post("/users", json=body, headers=admin_h).status_code == 409
    author_h = login(make_user(Role.AUTHOR))
    assert (
        client.post("/users", json={**body, "email": "z@example.com"}, headers=author_h).status_code
        == 403
    )


# Each role must be refused on routes belonging to the other roles.
ROUTES = {
    Role.ADMIN: [("get", "/users"), ("get", "/exams"), ("get", "/bank"), ("get", "/audit")],
    Role.AUTHOR: [("get", "/questions/mine")],
    Role.REVIEWER: [("get", "/reviews/queue")],
    Role.CANDIDATE: [("get", "/candidate/exams")],
}


@pytest.mark.parametrize("role", list(Role))
def test_role_boundaries(client, make_user, login, role):
    h = login(make_user(role))
    for owner, routes in ROUTES.items():
        for method, path in routes:
            r = getattr(client, method)(path, headers=h)
            expected = 200 if owner == role else 403
            assert r.status_code == expected, (
                f"{role.value} {method.upper()} {path}: {r.status_code}"
            )
