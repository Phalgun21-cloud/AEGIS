"""Phase 5 hardening: route guards, session cookie + CSRF, rate limits, headers, limits."""

import re
from datetime import timedelta

import pytest
from fastapi.routing import APIRoute
from pydantic import ValidationError

from app.api.deps import get_current_user
from app.core.config import Settings, get_settings
from app.main import app
from app.models import Role
from tests.conftest import PASSWORD

CSRF = {"X-AEGIS-CSRF": "1"}
ORIGIN = "http://localhost:3000"

# Routes anyone may call. Every other route must require a signed-in user.
PUBLIC = {
    ("GET", "/health"),
    ("GET", "/health/db"),
    ("POST", "/auth/login"),
    ("POST", "/auth/logout"),
}
# Routes open to any signed-in user that refuse some roles inside the handler.
HANDLER_REFUSES = {("GET", "/questions/{question_id}"): {Role.CANDIDATE}}


def _guard(route: APIRoute) -> frozenset[Role] | str | None:
    """The roles a route allows, "any" for any signed-in user, or None if unguarded."""
    found: frozenset[Role] | str | None = None
    stack = list(route.dependant.dependencies)
    while stack:
        dep = stack.pop()
        roles = getattr(dep.call, "allowed_roles", None)
        if roles is not None:
            return roles
        if dep.call is get_current_user:
            found = "any"
        stack.extend(dep.dependencies)
    return found


def _api_routes(routes, prefix=""):
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix, route
        elif hasattr(route, "original_router"):  # FastAPI's lazily included router
            ctx = route.include_context
            assert not ctx.dependencies, "guards on include_router() aren't walked here"
            yield from _api_routes(route.original_router.routes, prefix + ctx.prefix)


def _endpoints():
    for prefix, route in _api_routes(app.routes):
        assert prefix == "", "routers are expected to carry their own prefix"
        if route.include_in_schema:
            for method in sorted(route.methods - {"HEAD"}):
                yield method, route


def _url(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "999999", path)


def test_every_route_is_guarded_or_listed_public():
    unguarded = [
        (m, r.path) for m, r in _endpoints() if _guard(r) is None and (m, r.path) not in PUBLIC
    ]
    assert unguarded == [], "routes with no auth guard (add one, or list them in PUBLIC)"
    assert len(list(_endpoints())) > 40  # sanity: the walk found the API


def test_route_guard_matrix(client, make_user, login):
    """Anonymous -> 401 everywhere; each role -> 403 on every route that isn't theirs."""
    headers = {role: login(make_user(role)) for role in Role}
    checked = 0
    for method, route in _endpoints():
        if (method, route.path) in PUBLIC:
            continue
        url, guard = _url(route.path), _guard(route)
        r = client.request(method, url)
        assert r.status_code == 401, f"anonymous {method} {route.path}: {r.status_code}"
        for role in Role:
            allowed = guard == "any" or role in guard
            refused = role in HANDLER_REFUSES.get((method, route.path), set())
            r = client.request(method, url, headers=headers[role])
            if allowed and not refused:
                assert r.status_code not in (401, 403), (
                    f"{role.value} {method} {route.path}: {r.status_code} {r.text}"
                )
            else:
                assert r.status_code == 403, f"{role.value} {method} {route.path}: {r.status_code}"
            checked += 1
    assert checked > 150


# ---------- session cookie + CSRF ----------


def _cookie_login(client, user) -> str:
    r = client.post(
        "/auth/login", data={"username": user.email, "password": PASSWORD}, headers=CSRF
    )
    assert r.status_code == 200, r.text
    assert r.json()["access_token"] is None  # never exposed to page scripts
    return r.headers["set-cookie"]


def test_web_login_sets_httponly_strict_cookie(client, make_user):
    set_cookie = _cookie_login(client, make_user(Role.ADMIN)).lower()
    assert "aegis_session=" in set_cookie
    assert "httponly" in set_cookie and "samesite=strict" in set_cookie and "path=/" in set_cookie
    assert "secure" not in set_cookie  # development runs on http://localhost
    assert client.get("/auth/me").json()["role"] == "admin"


def test_api_login_without_csrf_header_sets_no_cookie(client, make_user):
    """Another site can't silently sign a browser into an account (login CSRF)."""
    r = client.post(
        "/auth/login", data={"username": make_user(Role.ADMIN).email, "password": PASSWORD}
    )
    assert r.status_code == 200 and r.json()["access_token"]
    assert "set-cookie" not in r.headers
    assert client.get("/auth/me").status_code == 401


def test_cookie_writes_need_the_csrf_header(client, make_user):
    _cookie_login(client, make_user(Role.ADMIN))
    body = {
        "email": "x@example.com",
        "full_name": "X",
        "password": "long-enough-pw",
        "role": "author",
    }
    r = client.post("/users", json=body)
    assert r.status_code == 403 and "CSRF" in r.json()["detail"]
    assert client.post("/users", json=body, headers=CSRF).status_code == 201


def test_bearer_clients_dont_need_the_csrf_header(client, make_user, login):
    h = login(make_user(Role.ADMIN))
    body = {
        "email": "y@example.com",
        "full_name": "Y",
        "password": "long-enough-pw",
        "role": "author",
    }
    assert client.post("/users", json=body, headers=h).status_code == 201


def test_logout_clears_cookie(client, make_user):
    _cookie_login(client, make_user(Role.CANDIDATE))
    r = client.post("/auth/logout")
    assert r.status_code == 204 and "max-age=0" in r.headers["set-cookie"].lower()
    assert client.get("/auth/me").status_code == 401


def test_active_session_is_renewed(client, make_user, monkeypatch):
    """A candidate using the app for longer than the token lifetime stays signed in."""
    from app.core import security

    user = make_user(Role.CANDIDATE)
    real = security.utcnow
    lifetime = get_settings().access_token_minutes
    monkeypatch.setattr(security, "utcnow", lambda: real() - timedelta(minutes=lifetime * 0.75))
    _cookie_login(client, user)  # issued "earlier": past half its life now
    monkeypatch.setattr(security, "utcnow", real)
    r = client.get("/auth/me")
    assert r.status_code == 200 and "aegis_session=" in r.headers.get("set-cookie", "")
    # A fresh token isn't reissued on every request.
    assert "set-cookie" not in client.get("/auth/me").headers


def test_tampered_cookie_is_rejected(client):
    client.cookies.set("aegis_session", "eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0.")
    assert client.get("/auth/me").status_code == 401


def test_websocket_rejects_foreign_origin(client, make_user):
    from starlette.websockets import WebSocketDisconnect

    _cookie_login(client, make_user(Role.ADMIN))
    with (
        pytest.raises(WebSocketDisconnect),
        client.websocket_connect(
            "/ws/exams/1/monitor", headers={"origin": "https://evil.example"}
        ) as ws,
    ):
        ws.receive_json()


# ---------- rate limiting ----------


def test_failed_logins_are_throttled_per_account(client, make_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_failures_per_account", 3)
    user, other = make_user(Role.CANDIDATE), make_user(Role.CANDIDATE)
    bad = {"username": user.email, "password": "wrong-password-1"}
    for _ in range(3):
        assert client.post("/auth/login", data=bad).status_code == 401
    r = client.post("/auth/login", data={"username": user.email, "password": PASSWORD})
    assert r.status_code == 429  # even the right password waits now
    assert int(r.headers["retry-after"]) > 0
    # Other accounts are unaffected.
    ok = client.post("/auth/login", data={"username": other.email, "password": PASSWORD})
    assert ok.status_code == 200


def test_success_resets_failure_count(client, make_user, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_failures_per_account", 3)
    user = make_user(Role.CANDIDATE)
    for _ in range(5):
        bad = {"username": user.email, "password": "wrong-password-1"}
        client.post("/auth/login", data=bad)
        client.post("/auth/login", data=bad)
        good = {"username": user.email, "password": PASSWORD}
        assert client.post("/auth/login", data=good).status_code == 200


def test_login_attempts_are_throttled_per_ip(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_attempts_per_ip_per_minute", 5)
    codes = [
        client.post(
            "/auth/login", data={"username": f"u{i}@example.com", "password": "x" * 12}
        ).status_code
        for i in range(7)
    ]
    assert codes == [401] * 5 + [429] * 2


# ---------- input limits ----------


def test_oversized_passwords_dont_crash(client, make_user, login):
    user = make_user(Role.ADMIN)
    r = client.post("/auth/login", data={"username": user.email, "password": "p" * 100_000})
    assert r.status_code == 401
    h = login(user)
    body = {"email": "u@example.com", "full_name": "U", "role": "author", "password": "é" * 40}
    r = client.post("/users", json=body, headers=h)
    assert r.status_code == 422  # 80 bytes: bcrypt would silently ignore the tail
    assert "72 bytes" in r.text


def test_request_body_size_limit(client, make_user, login, monkeypatch):
    import app.main

    h = login(make_user(Role.ADMIN))
    monkeypatch.setattr(app.main.app, "middleware_stack", None)  # rebuild with a small limit
    from app.core import middleware

    original = middleware.BodySizeLimitMiddleware.__init__

    def small(self, app_, *, max_bytes):
        original(self, app_, max_bytes=1024)

    monkeypatch.setattr(middleware.BodySizeLimitMiddleware, "__init__", small)
    try:
        big = b'{"title": "' + b"x" * 5000 + b'"}'
        r = client.post("/exams", content=big, headers={**h, "Content-Type": "application/json"})
        assert r.status_code == 413
        # Without Content-Length (chunked), the limit still applies while reading.
        r = client.post(
            "/exams",
            content=iter([big[:800], big[800:]]),
            headers={**h, "Content-Type": "application/json"},
        )
        assert r.status_code == 413
        assert client.get("/health").status_code == 200
    finally:
        monkeypatch.undo()
        app.main.app.middleware_stack = None


# ---------- headers, CORS, production settings ----------


def test_security_headers(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "default-src 'none'" in r.headers["content-security-policy"]
    assert r.headers["cache-control"] == "no-store"
    assert "strict-transport-security" not in r.headers  # only in production (HTTPS)


def test_cors_allows_only_configured_origins(client):
    pre = {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-aegis-csrf",
    }
    ok = client.options("/users", headers={"Origin": ORIGIN, **pre})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == ORIGIN
    evil = client.options("/users", headers={"Origin": "https://evil.example", **pre})
    assert evil.status_code == 400 and "access-control-allow-origin" not in evil.headers
    odd = client.options(
        "/users", headers={"Origin": ORIGIN, **pre, "Access-Control-Request-Headers": "x-custom"}
    )
    assert odd.status_code == 400


def _prod(**kw) -> Settings:
    base = {
        "environment": "production",
        "jwt_secret": "s" * 48,
        "vault_private_key": "-----BEGIN PRIVATE KEY-----...",
        "cors_origins": "https://aegis.example.com",
        "_env_file": None,
    }
    return Settings(**{**base, **kw})


def test_production_settings_are_strict():
    s = _prod()
    assert s.secure_cookies and s.session_cookie.startswith("__Host-")
    assert s.docs_enabled is False
    for bad in ("http://aegis.example.com", "*", "https://ok.example.com,http://x.example.com", ""):
        with pytest.raises(ValidationError):
            _prod(cors_origins=bad)
    with pytest.raises(ValidationError):
        _prod(jwt_secret="short")
    with pytest.raises(ValidationError):
        _prod(vault_private_key="")
