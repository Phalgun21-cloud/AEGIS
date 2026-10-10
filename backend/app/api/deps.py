from collections.abc import Callable
from datetime import UTC, datetime

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token
from app.db import get_db
from app.models import Role, User

# API clients send "Authorization: Bearer <token>"; the web app uses an httpOnly cookie.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)

# Sent by the web app on every request. A cross-site page can't add custom headers without
# a CORS preflight (which only our own origins pass), so it can't ride on the session cookie.
CSRF_HEADER = "X-AEGIS-CSRF"
_SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or expired credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def _decode(token: str) -> tuple[int, dict] | None:
    try:
        payload = decode_access_token(token)
        return int(payload["sub"]), payload
    except (jwt.PyJWTError, KeyError, ValueError, TypeError):
        return None


def user_from_token(db: Session, token: str) -> User | None:
    decoded = _decode(token)
    if decoded is None:
        return None
    user = db.get(User, decoded[0])
    if user is None or not user.is_active:
        return None
    return user


def set_session_cookie(response: Response, user: User) -> None:
    s = get_settings()
    response.set_cookie(
        s.session_cookie,
        create_access_token(user.id, user.role.value),
        max_age=s.access_token_minutes * 60,
        path="/",
        httponly=True,
        secure=s.secure_cookies,
        samesite="strict",
    )


def clear_session_cookie(response: Response) -> None:
    s = get_settings()
    response.delete_cookie(
        s.session_cookie, path="/", httponly=True, secure=s.secure_cookies, samesite="strict"
    )


def get_current_user(
    request: Request,
    response: Response,
    bearer: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    cookie = request.cookies.get(get_settings().session_cookie)
    token = bearer or cookie
    if not token:
        raise _UNAUTHORIZED
    from_cookie = bearer is None
    csrf_ok = request.headers.get(CSRF_HEADER) == "1"
    if from_cookie and request.method not in _SAFE_METHODS and not csrf_ok:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF header")
    decoded = _decode(token)
    if decoded is None:
        raise _UNAUTHORIZED
    user = db.get(User, decoded[0])
    # End the read transaction: it returns the connection to the pool while this request
    # waits for a worker thread. Without it, a burst of requests (every candidate starting at
    # the release second) holds more connections than the pool has, and requests time out.
    db.commit()
    if user is None or not user.is_active:
        raise _UNAUTHORIZED
    if from_cookie and _past_half_life(decoded[1]):
        # Sliding session: keep an active user (e.g. a candidate mid-exam) signed in.
        set_session_cookie(response, user)
    return user


def _past_half_life(payload: dict) -> bool:
    lifetime = get_settings().access_token_minutes * 60
    remaining = payload["exp"] - datetime.now(UTC).timestamp()
    return remaining < lifetime / 2


def require_roles(*roles: Role) -> Callable[..., User]:
    """Route dependency: the caller must be logged in with one of `roles`."""

    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not permitted for your role")
        return user

    checker.allowed_roles = frozenset(roles)  # read by the route-guard tests
    return checker


require_admin = require_roles(Role.ADMIN)
require_author = require_roles(Role.AUTHOR)
require_reviewer = require_roles(Role.REVIEWER)
require_candidate = require_roles(Role.CANDIDATE)
