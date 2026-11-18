from datetime import timedelta

import bcrypt
import jwt

from app.core.config import get_settings
from app.core.timeutil import utcnow


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: int, role: str) -> str:
    s = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "iat": now,
        "exp": now + timedelta(minutes=s.access_token_minutes),
    }
    return jwt.encode(payload, s.jwt_secret, algorithm=s.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError if the token is invalid or expired."""
    s = get_settings()
    return jwt.decode(token, s.jwt_secret, algorithms=[s.jwt_algorithm])


# ---------- email verification tokens ----------
# Signed with a key derived from (not equal to) the session secret, so a verification link can
# never be replayed as a sign-in session, and vice versa.
_VERIFY_PURPOSE = "aegis-email-verification"


def _verify_key() -> str:
    return f"{get_settings().jwt_secret}:{_VERIFY_PURPOSE}"


def create_email_verification_token(user_id: int, email: str) -> str:
    s = get_settings()
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "email": email,  # bound to the address: changing the email invalidates old links
        "purpose": _VERIFY_PURPOSE,
        "iat": now,
        "exp": now + timedelta(hours=s.email_verify_hours),
    }
    return jwt.encode(payload, _verify_key(), algorithm="HS256")


def decode_email_verification_token(token: str) -> tuple[int, str]:
    """Returns (user_id, email). Raises jwt.PyJWTError if invalid, expired or the wrong kind."""
    payload = jwt.decode(token, _verify_key(), algorithms=["HS256"])
    if payload.get("purpose") != _VERIFY_PURPOSE:
        raise jwt.InvalidTokenError("not an email verification token")
    return int(payload["sub"]), str(payload["email"])
