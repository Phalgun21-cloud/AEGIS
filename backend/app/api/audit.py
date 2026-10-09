from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db import get_db
from app.models import AnchorStatus, AuditLog, BlockchainAnchor, User
from app.services.anchor import (
    AnchorClient,
    AnchorError,
    anchor_now,
    get_client,
    last_anchor,
    verify_anchor,
)
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


# ---------- blockchain anchoring (Phase 4, optional) ----------


def anchor_client() -> AnchorClient | None:
    """Dependency so tests can substitute a fake chain."""
    try:
        return get_client()
    except Exception as exc:  # misconfigured RPC / contract
        raise HTTPException(503, f"Blockchain anchoring is misconfigured: {exc}") from exc


def _require_client(client: AnchorClient | None) -> AnchorClient:
    if client is None:
        raise HTTPException(503, "Blockchain anchoring is disabled (set ANCHOR_ENABLED=true)")
    return client


def _anchor_row(a: BlockchainAnchor) -> dict:
    return {
        "id": a.id,
        "audit_log_id": a.audit_log_id,
        "entry_hash": a.entry_hash,
        "status": a.status.value,
        "chain_id": a.chain_id,
        "contract_address": a.contract_address,
        "tx_hash": a.tx_hash,
        "block_number": a.block_number,
        "onchain_index": a.onchain_index,
        "error": a.error,
        "created_at": a.created_at.isoformat(),
        "confirmed_at": a.confirmed_at.isoformat() if a.confirmed_at else None,
    }


@router.get("/anchors")
def list_anchors(
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    client: AnchorClient | None = Depends(anchor_client),
) -> dict:
    rows = db.execute(
        select(BlockchainAnchor).order_by(BlockchainAnchor.id.desc()).limit(100)
    ).scalars()
    last = last_anchor(db)
    head_id = db.execute(select(func.max(AuditLog.id))).scalar_one()
    return {
        "enabled": client is not None,
        "chain_id": client.chain_id if client else None,
        "contract_address": client.contract_address if client else None,
        "head_audit_id": head_id,
        "last_anchored_audit_id": last.audit_log_id if last else None,
        "anchors": [_anchor_row(a) for a in rows],
    }


@router.post("/anchors")
def create_anchor(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    client: AnchorClient | None = Depends(anchor_client),
) -> dict:
    """Anchor the current audit-chain head now."""
    client = _require_client(client)
    try:
        row = anchor_now(db, client, actor=admin)
    except AnchorError as exc:
        raise HTTPException(409, str(exc)) from exc
    if row is None:
        return {"anchored": False, "detail": "The current audit head is already anchored."}
    if row.status == AnchorStatus.FAILED:
        raise HTTPException(502, f"Anchoring failed: {row.error}")
    return {"anchored": True, "anchor": _anchor_row(row)}


@router.get("/anchors/{anchor_id}/verify")
def verify_anchor_route(
    anchor_id: int,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    client: AnchorClient | None = Depends(anchor_client),
) -> dict:
    client = _require_client(client)
    row = db.get(BlockchainAnchor, anchor_id)
    if row is None:
        raise HTTPException(404, "Anchor not found")
    try:
        return verify_anchor(db, client, row)
    except Exception as exc:  # RPC failure
        raise HTTPException(502, f"Could not read the chain: {exc}") from exc
