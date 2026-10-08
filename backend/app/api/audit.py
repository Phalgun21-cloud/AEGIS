from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db import get_db
from app.models import AuditLog, User
from app.services.audit import verify_chain

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
def list_entries(
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    actor_id: int | None = None,
    before_id: int | None = Query(default=None, description="Pagination cursor"),
    limit: int = Query(default=50, ge=1, le=500),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict]:
    q = (
        select(AuditLog, User.full_name)
        .outerjoin(User, User.id == AuditLog.actor_id)
        .order_by(AuditLog.id.desc())
        .limit(limit)
    )
    if action:
        q = q.where(AuditLog.action == action)
    if entity_type:
        q = q.where(AuditLog.entity_type == entity_type)
    if entity_id:
        q = q.where(AuditLog.entity_id == entity_id)
    if actor_id is not None:
        q = q.where(AuditLog.actor_id == actor_id)
    if before_id is not None:
        q = q.where(AuditLog.id < before_id)
    return [_row(e, name) for e, name in db.execute(q).all()]


def _row(e: AuditLog, actor_name: str | None) -> dict:
    created: datetime = e.created_at
    return {
        "id": e.id,
        "action": e.action,
        "actor_id": e.actor_id,
        "actor_name": actor_name,
        "entity_type": e.entity_type,
        "entity_id": e.entity_id,
        "details": e.details,
        "created_at": created.isoformat(),
        "prev_hash": e.prev_hash,
        "entry_hash": e.entry_hash,
    }


@router.get("/verify")
def verify(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    """Recompute the hash chain. `valid: false` means a row was altered or removed."""
    return verify_chain(db).__dict__
