"""Append-only, hash-chained audit log.

entry_hash = SHA-256(prev_hash || canonical JSON of the entry). Editing or deleting any
row breaks every hash after it, which `verify_chain` detects. Entry hashes are also what
the optional blockchain layer (Phase 4) will anchor.
"""

import hashlib
import json
from dataclasses import dataclass

from sqlalchemy import event, select, update
from sqlalchemy.orm import Session

from app.core.timeutil import utcnow
from app.models import AuditChainHead, AuditLog, User

GENESIS = "0" * 64


def _entry_hash(prev_hash: str, entry: AuditLog) -> str:
    body = {
        "actor_id": entry.actor_id,
        "action": entry.action,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "details": entry.details,
        "created_at": entry.created_at.isoformat(timespec="seconds"),
    }
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256((prev_hash + canonical).encode()).hexdigest()


def record(
    db: Session,
    action: str,
    *,
    actor: User | int | None = None,
    entity_type: str | None = None,
    entity_id: object = None,
    details: dict | None = None,
) -> None:
    """Queue an audit entry on the current transaction. It is chained and written when the
    caller commits, so it lands atomically with the change it describes (and is dropped if
    the transaction rolls back)."""
    actor_id = actor.id if isinstance(actor, User) else actor
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=None if entity_id is None else str(entity_id),
        details=details,
        # Whole seconds: MySQL DATETIME drops microseconds, which would break the hash.
        created_at=utcnow().replace(microsecond=0),
    )
    if not db.in_transaction():
        db.begin()  # so a rollback, even before any SQL ran, discards the queued entry
    db.info.setdefault(_PENDING, []).append(entry)


_PENDING = "aegis.audit_pending"


def _lock_head(db: Session) -> AuditChainHead:
    """Take the chain-head row lock (an UPDATE locks on MySQL and SQLite alike), then read
    the head as committed by whoever appended last."""
    bumped = db.execute(
        update(AuditChainHead)
        .where(AuditChainHead.id == 1)
        .values(version=AuditChainHead.version + 1)
        .execution_options(synchronize_session=False)
    ).rowcount
    if not bumped:  # database created without migrations (tests): start from the tip
        tip = db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1)).scalar()
        head = AuditChainHead(
            id=1,
            last_entry_id=tip.id if tip else None,
            last_hash=tip.entry_hash if tip else GENESIS,
            version=1,
        )
        db.add(head)
        db.flush()
        return head
    return db.get(AuditChainHead, 1, populate_existing=True)


@event.listens_for(Session, "before_commit")
def _append_pending(db: Session) -> None:
    # Runs last in every transaction, so the head lock is the final lock taken and is held
    # only for the moment of the commit: appends serialise without causing deadlocks.
    pending = db.info.pop(_PENDING, None)
    if not pending:
        return
    head = _lock_head(db)
    prev = head.last_hash
    for entry in pending:
        entry.prev_hash = prev
        entry.entry_hash = _entry_hash(prev, entry)
        db.add(entry)
        db.flush()  # one at a time, so ids follow chain order
        prev = entry.entry_hash
    head.last_hash = prev
    head.last_entry_id = pending[-1].id
    db.flush()


@event.listens_for(Session, "after_soft_rollback")
def _drop_pending(db: Session, _previous_transaction) -> None:
    db.info.pop(_PENDING, None)


@dataclass
class ChainReport:
    valid: bool
    entries: int
    first_broken_id: int | None = None
    head_hash: str | None = None


def verify_chain(db: Session, up_to_id: int | None = None) -> ChainReport:
    """Recompute the chain from the start (optionally only up to entry `up_to_id`)."""
    prev = GENESIS
    count = 0
    q = select(AuditLog).order_by(AuditLog.id)
    if up_to_id is not None:
        q = q.where(AuditLog.id <= up_to_id)
    for entry in db.execute(q).scalars():
        count += 1
        if entry.prev_hash != prev or entry.entry_hash != _entry_hash(prev, entry):
            return ChainReport(False, count, entry.id, prev)
        prev = entry.entry_hash
    if up_to_id is None:
        # Entries removed from the end leave an intact but shorter chain; the head knows.
        head = db.get(AuditChainHead, 1)
        if head is not None and head.last_hash != prev:
            return ChainReport(False, count, head.last_entry_id, prev)
    return ChainReport(True, count, None, prev)
