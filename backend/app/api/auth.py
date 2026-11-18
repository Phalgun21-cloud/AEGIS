import jwt
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import (
    CSRF_HEADER,
    clear_session_cookie,
    get_current_user,
    require_admin,
    set_session_cookie,
)
from app.core.config import get_settings
from app.core.ratelimit import SlidingWindowLimiter
from app.core.security import (
    create_access_token,
    decode_email_verification_token,
    hash_password,
    verify_password,
)
from app.core.timeutil import utcnow
from app.db import get_db
from app.models import Role, User
from app.schemas import (
    AuthConfig,
    GoogleLoginRequest,
    ResendVerificationRequest,
    Token,
    UserCreate,
    UserOut,
    UserUpdate,
    VerifyEmailRequest,
)
from app.services import audit
from app.services.google_auth import GoogleTokenError, verify_google_id_token
from app.services.verification import send_verification_email

router = APIRouter(tags=["auth"])

# Compared against when the email is unknown, so response time doesn't reveal which
# accounts exist.
_DUMMY_HASH = hash_password("aegis-timing-equaliser")


# Every attempt from one IP (slows password spraying across many accounts)...
login_ip_limiter = SlidingWindowLimiter(
    lambda: get_settings().login_attempts_per_ip_per_minute, lambda: 60
)
# ...and failed attempts per IP + account (slows guessing one password). Keyed on the IP too,
# so a stranger can't lock a candidate out of their exam by failing logins on purpose.
login_failure_limiter = SlidingWindowLimiter(
    lambda: get_settings().login_failures_per_account,
    lambda: get_settings().login_failure_window_minutes * 60,
)


resend_limiter = SlidingWindowLimiter(lambda: 3, lambda: 3600)

UNVERIFIED = (
    "Please verify your email address before signing in. "
    "Open the link we sent to your inbox, or request a new one below."
)


def _too_many(retry_after: int) -> HTTPException:
    return HTTPException(
        status.HTTP_429_TOO_MANY_REQUESTS,
        f"Too many sign-in attempts. Try again in {retry_after} seconds.",
        headers={"Retry-After": str(retry_after)},
    )


@router.post("/auth/login", response_model=Token)
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> Token:
    email = form.username.strip().lower()[:320]
    ip = request.client.host if request.client else "unknown"
    if wait := login_ip_limiter.hit(ip):
        raise _too_many(wait)
    if wait := login_failure_limiter.retry_after((ip, email)):
        raise _too_many(wait)

    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    ok = verify_password(form.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not ok or not user.is_active:
        login_failure_limiter.hit((ip, email))
        audit.record(db, "auth.login_failed", details={"email": email})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    login_failure_limiter.reset((ip, email))
    if not user.email_verified:
        audit.record(db, "auth.login_unverified", actor=user, entity_type="user", entity_id=user.id)
        db.commit()
        raise HTTPException(status.HTTP_403_FORBIDDEN, UNVERIFIED)
    audit.record(db, "auth.login", actor=user, entity_type="user", entity_id=user.id)
    db.commit()
    return _issue_session(request, response, user)


def _issue_session(request: Request, response: Response, user: User) -> Token:
    # The web app (which sends the CSRF header) gets an httpOnly cookie. Requiring the header
    # here too stops another site from silently signing a browser into some other account.
    # The token itself then stays out of reach of page scripts.
    if request.headers.get(CSRF_HEADER) == "1":
        set_session_cookie(response, user)
        return Token(access_token=None, role=user.role)
    return Token(access_token=create_access_token(user.id, user.role.value), role=user.role)


@router.post("/auth/logout", status_code=204)
def logout() -> Response:
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    body: UserCreate,
    background: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    email = body.email.strip().lower()
    if db.execute(select(User.id).where(User.email == email)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "A user with that email already exists")
    user = User(
        email=email,
        full_name=body.full_name.strip(),
        password_hash=hash_password(body.password),
        role=body.role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    audit.record(
        db,
        "user.created",
        actor=admin,
        entity_type="user",
        entity_id=user.id,
        details={"role": user.role.value},
    )
    db.commit()
    background.add_task(send_verification_email, user.id, user.email, user.full_name)
    return user


@router.get("/users", response_model=list[UserOut])
def list_users(
    role: Role | None = None,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    q = select(User).order_by(User.id)
    if role is not None:
        q = q.where(User.role == role)
    return list(db.execute(q).scalars())


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id and body.is_active is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate yourself")
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(user, k, v)
    audit.record(
        db,
        "user.updated",
        actor=admin,
        entity_type="user",
        entity_id=user.id,
        details=changes,
    )
    db.commit()
    return user


# ---------- email verification ----------


@router.post("/auth/verify-email")
def verify_email(body: VerifyEmailRequest, db: Session = Depends(get_db)) -> dict:
    """Public: the link in the verification email lands here (through the web app)."""
    try:
        user_id, email = decode_email_verification_token(body.token)
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This verification link is invalid or has expired. Request a new one from the sign-in page.",
        ) from None
    user = db.get(User, user_id)
    if user is None or user.email != email or not user.is_active:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "This verification link is no longer valid."
        )
    if not user.email_verified:
        user.email_verified_at = utcnow()
        audit.record(db, "user.email_verified", actor=user, entity_type="user", entity_id=user.id)
        db.commit()
    return {"verified": True, "email": user.email}


@router.post("/auth/resend-verification", status_code=202)
def resend_verification(
    body: ResendVerificationRequest,
    request: Request,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
) -> dict:
    """Public. Always answers the same way, so it can't be used to discover which emails exist."""
    email = body.email.strip().lower()
    ip = request.client.host if request.client else "unknown"
    if wait := resend_limiter.hit((ip, email)):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many requests. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is not None and user.is_active and not user.email_verified:
        background.add_task(send_verification_email, user.id, user.email, user.full_name)
    return {"sent": True}


@router.post("/users/{user_id}/resend-verification", status_code=202)
def admin_resend_verification(
    user_id: int,
    background: BackgroundTasks,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.email_verified:
        raise HTTPException(status.HTTP_409_CONFLICT, "This email address is already verified")
    background.add_task(send_verification_email, user.id, user.email, user.full_name)
    audit.record(db, "user.verification_resent", actor=admin, entity_type="user", entity_id=user.id)
    db.commit()
    return {"sent": True}


@router.post("/users/{user_id}/mark-verified", response_model=UserOut)
def admin_mark_verified(
    user_id: int, admin: User = Depends(require_admin), db: Session = Depends(get_db)
) -> User:
    """For accounts whose mailbox can't receive mail (demo and test accounts). Audited."""
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if not user.email_verified:
        user.email_verified_at = utcnow()
        audit.record(
            db,
            "user.email_verified",
            actor=admin,
            entity_type="user",
            entity_id=user.id,
            details={"method": "admin"},
        )
        db.commit()
    return user


# ---------- Sign in with Google ----------


@router.get("/auth/config", response_model=AuthConfig)
def auth_config() -> AuthConfig:
    """Public settings the sign-in page needs (the Google client ID is not a secret)."""
    return AuthConfig(google_client_id=get_settings().google_client_id or None)


@router.post("/auth/google", response_model=Token)
def google_login(
    body: GoogleLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> Token:
    """Google proves who the person is; AEGIS decides whether they may enter and with what role.
    Only accounts an administrator has already created can sign in this way."""
    client_id = get_settings().google_client_id
    if not client_id:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Sign in with Google is not configured"
        )
    ip = request.client.host if request.client else "unknown"
    if wait := login_ip_limiter.hit(ip):
        raise _too_many(wait)
    try:
        email = verify_google_id_token(body.credential, client_id)
    except GoogleTokenError:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Google sign-in could not be verified"
        ) from None
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    if user is None or not user.is_active:
        audit.record(db, "auth.login_failed", details={"email": email, "method": "google"})
        db.commit()
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "No active AEGIS account uses this Google address. "
            "Ask your examination administrator to create one.",
        )
    if not user.email_verified:  # Google has verified the address
        user.email_verified_at = utcnow()
        audit.record(
            db,
            "user.email_verified",
            actor=user,
            entity_type="user",
            entity_id=user.id,
            details={"method": "google"},
        )
    audit.record(
        db,
        "auth.login",
        actor=user,
        entity_type="user",
        entity_id=user.id,
        details={"method": "google"},
    )
    db.commit()
    return _issue_session(request, response, user)
