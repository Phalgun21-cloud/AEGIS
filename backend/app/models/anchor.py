import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.timeutil import utcnow
from app.db import Base
from app.models.types import enum_values


class AnchorStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    FAILED = "failed"


class BlockchainAnchor(Base):
    """One on-chain checkpoint of the audit chain head (see services/anchor.py)."""

    __tablename__ = "blockchain_anchors"

    id: Mapped[int] = mapped_column(primary_key=True)
    audit_log_id: Mapped[int] = mapped_column(ForeignKey("audit_logs.id"), index=True)
    entry_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[AnchorStatus] = mapped_column(
        Enum(AnchorStatus, values_callable=enum_values), default=AnchorStatus.PENDING
    )
    chain_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    contract_address: Mapped[str | None] = mapped_column(String(42), nullable=True)
    tx_hash: Mapped[str | None] = mapped_column(String(66), nullable=True)
    block_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    onchain_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
