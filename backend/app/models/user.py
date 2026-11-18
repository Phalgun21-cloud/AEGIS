import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utcnow
from app.db import Base


class Role(str, enum.Enum):
    ADMIN = "admin"
    AUTHOR = "author"
    REVIEWER = "reviewer"
    CANDIDATE = "candidate"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, values_callable=lambda e: [m.value for m in e]))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Set when the user proves they own the address (verification link or Google sign-in).
    # Password sign-in is refused until then.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None
