"""Append-only, hash-chained audit log.

entry_hash = SHA-256(prev_hash || canonical JSON of the entry). Editing or deleting any
row breaks every hash after it, which `verify_chain` detects. Entry hashes are also what
the optional blockchain layer (Phase 4) will anchor.
"""

import hashlib
import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.timeutil import utcnow
from app.models import AuditLog, User

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
) -> AuditLog:
    """Add an audit entry to the current transaction. The caller commits, so the entry
    lands atomically with the change it describes."""
    actor_id = actor.id if isinstance(actor, User) else actor
    # Lock the chain tip so concurrent writers serialise (no-op on SQLite).
    last = db.execute(
        select(AuditLog.entry_hash).order_by(AuditLog.id.desc()).limit(1).with_for_update()
    ).scalar_one_or_none()
    prev = last or GENESIS
    entry = AuditLog(
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=None if entity_id is None else str(entity_id),
        details=details,
        prev_hash=prev,
        # Whole seconds: MySQL DATETIME drops microseconds, which would break the hash.
        created_at=utcnow().replace(microsecond=0),
    )
    entry.entry_hash = _entry_hash(prev, entry)
    db.add(entry)
    db.flush()
    return entry


@dataclass
class ChainReport:
    valid: bool
    entries: int
    first_broken_id: int | None = None
    head_hash: str | None = None


def verify_chain(db: Session) -> ChainReport:
    prev = GENESIS
    count = 0
    for entry in db.execute(select(AuditLog).order_by(AuditLog.id)).scalars():
        count += 1
        if entry.prev_hash != prev or entry.entry_hash != _entry_hash(prev, entry):
            return ChainReport(False, count, entry.id, prev)
        prev = entry.entry_hash
    return ChainReport(True, count, None, prev)
