from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_admin
from app.core.security import create_access_token, hash_password, verify_password
from app.db import get_db
from app.models import Role, User
from app.schemas import Token, UserCreate, UserOut, UserUpdate
from app.services import audit

router = APIRouter(tags=["auth"])

# Compared against when the email is unknown, so response time doesn't reveal which
# accounts exist.
_DUMMY_HASH = hash_password("aegis-timing-equaliser")


@router.post("/auth/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)) -> Token:
    email = form.username.strip().lower()
    user = db.execute(select(User).where(User.email == email)).scalar_one_or_none()
    ok = verify_password(form.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not ok or not user.is_active:
        audit.record(db, "auth.login_failed", details={"email": email})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    audit.record(db, "auth.login", actor=user, entity_type="user", entity_id=user.id)
    db.commit()
    return Token(access_token=create_access_token(user.id, user.role.value), role=user.role)


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    body: UserCreate, admin: User = Depends(require_admin), db: Session = Depends(get_db)
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
