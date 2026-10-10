from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AuditLog(Base):
    """Append-only event log. Each row stores a hash chained to the previous row
    (populated by the audit service in a later phase)."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(100), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    entry_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class AuditChainHead(Base):
    """Single row (id=1) pointing at the newest audit entry.

    Appending to the chain locks this row, so concurrent transactions append one after
    another and never both link to the same previous entry. It also lets verification spot
    entries deleted from the end of the log.
    """

    __tablename__ = "audit_chain_head"

    id: Mapped[int] = mapped_column(primary_key=True)
    last_entry_id: Mapped[int | None] = mapped_column(nullable=True)
    last_hash: Mapped[str] = mapped_column(String(64))
    version: Mapped[int] = mapped_column(default=0)
