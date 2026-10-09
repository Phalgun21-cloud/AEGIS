"""Optional blockchain anchoring of the audit chain (Phase 4).

Every audit entry's hash covers the previous entry's hash, so writing the current chain
head (entry_hash + id) to the AuditAnchor contract commits to every entry up to it.
Afterwards, editing or deleting any covered row is detectable even by someone who controls
the database, by comparing the recomputed chain with the on-chain value.

Only hashes go on-chain; never exam content or personal data. Testnet / local chain only.
"""

import json
import logging
from dataclasses import dataclass
from datetime import timedelta
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.timeutil import utcnow
from app.models import AnchorStatus, AuditLog, BlockchainAnchor
from app.services import audit

log = logging.getLogger("aegis.anchor")

ABI_PATH = Path(__file__).parent / "abi" / "AuditAnchor.json"

# Events important enough to trigger an anchor soon after they happen.
CRITICAL_ACTIONS = (
    "question.approved",
    "paper.generated",
    "paper.discarded",
    "paper.released",
    "attempt.submitted",
    "attempt.auto_submitted",
    "exam.closed",
)


class AnchorError(Exception):
    pass


@dataclass
class OnChainAnchor:
    head_hash: str  # hex, no 0x
    audit_entry_id: int
    anchored_at: int  # unix seconds


@dataclass
class TxResult:
    tx_hash: str
    block_number: int
    index: int


class AnchorClient(Protocol):
    chain_id: int
    contract_address: str

    def anchor(self, head_hash: str, audit_entry_id: int) -> TxResult: ...

    def get_anchor(self, index: int) -> OnChainAnchor: ...

    def latest(self) -> OnChainAnchor | None: ...


class Web3AnchorClient:
    """Talks to the deployed AuditAnchor contract with Web3.py."""

    def __init__(self, rpc_url: str, contract_address: str, private_key: str, chain_id: int = 0):
        from eth_account import Account
        from web3 import Web3

        self._w3 = Web3(Web3.HTTPProvider(rpc_url, request_kwargs={"timeout": 30}))
        self._account = Account.from_key(private_key)
        self.contract_address = Web3.to_checksum_address(contract_address)
        self._contract = self._w3.eth.contract(
            address=self.contract_address, abi=json.loads(ABI_PATH.read_text())
        )
        self.chain_id = chain_id or self._w3.eth.chain_id

    def anchor(self, head_hash: str, audit_entry_id: int) -> TxResult:
        tx = self._contract.functions.anchor(
            bytes.fromhex(head_hash), audit_entry_id
        ).build_transaction(
            {
                "from": self._account.address,
                "nonce": self._w3.eth.get_transaction_count(self._account.address, "pending"),
                "chainId": self.chain_id,
            }
        )
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self._w3.eth.wait_for_transaction_receipt(tx_hash, timeout=180)
        if receipt["status"] != 1:
            raise AnchorError(f"transaction {tx_hash.hex()} reverted")
        events = self._contract.events.Anchored().process_receipt(receipt)
        return TxResult(
            tx_hash="0x" + bytes(tx_hash).hex().removeprefix("0x"),
            block_number=receipt["blockNumber"],
            index=events[0]["args"]["index"],
        )

    def get_anchor(self, index: int) -> OnChainAnchor:
        head, entry_id, at = self._contract.functions.getAnchor(index).call()
        return OnChainAnchor(bytes(head).hex(), entry_id, at)

    def latest(self) -> OnChainAnchor | None:
        n = self._contract.functions.anchorCount().call()
        return self.get_anchor(n - 1) if n else None


@lru_cache
def _cached_client() -> AnchorClient:
    s = get_settings()
    return Web3AnchorClient(
        s.anchor_rpc_url, s.anchor_contract_address, s.anchor_private_key, s.anchor_chain_id
    )


def get_client() -> AnchorClient | None:
    """The configured client, or None when anchoring is disabled."""
    if not get_settings().anchor_enabled:
        return None
    return _cached_client()


def last_anchor(db: Session) -> BlockchainAnchor | None:
    return db.execute(
        select(BlockchainAnchor)
        .where(BlockchainAnchor.status == AnchorStatus.CONFIRMED)
        .order_by(BlockchainAnchor.audit_log_id.desc())
        .limit(1)
    ).scalar_one_or_none()


def anchor_now(db: Session, client: AnchorClient, actor=None) -> BlockchainAnchor | None:
    """Anchor the current chain head. Returns None when the head is already anchored.

    Refuses to anchor a chain that doesn't verify: anchoring would endorse tampered data.
    """
    head = db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1)).scalar_one_or_none()
    if head is None:
        return None
    prev = last_anchor(db)
    if prev is not None and prev.audit_log_id >= head.id:
        return None
    report = audit.verify_chain(db, up_to_id=head.id)
    if not report.valid:
        raise AnchorError(f"audit chain is broken at entry {report.first_broken_id}; not anchoring")

    row = BlockchainAnchor(
        audit_log_id=head.id,
        entry_hash=head.entry_hash,
        status=AnchorStatus.PENDING,
        chain_id=client.chain_id,
        contract_address=client.contract_address,
    )
    db.add(row)
    db.commit()  # keep a record even if the process dies mid-transaction

    def fail(message: str) -> BlockchainAnchor:
        row.status = AnchorStatus.FAILED
        row.error = message[:1000]
        audit.record(
            db,
            "audit.anchor_failed",
            actor=actor,
            entity_type="anchor",
            entity_id=row.id,
            details={"audit_log_id": head.id},
        )
        db.commit()
        log.warning("anchoring audit entry %s failed: %s", head.id, message)
        return row

    try:
        onchain = client.latest()
        if onchain is not None and onchain.audit_entry_id >= head.id:
            # The contract only accepts increasing ids, so this would revert anyway.
            return fail(
                f"The contract already holds a checkpoint for audit entry "
                f"{onchain.audit_entry_id}, but this database's newest entry is {head.id}. "
                "Either the audit log was rolled back or truncated, or this contract is "
                "shared with another environment. Use one contract per environment."
            )
        result = client.anchor(head.entry_hash, head.id)
    except Exception as exc:  # noqa: BLE001  (network, gas, revert: record and surface)
        return fail(getattr(exc, "message", None) or str(exc))
    row.status = AnchorStatus.CONFIRMED
    row.tx_hash = result.tx_hash
    row.block_number = result.block_number
    row.onchain_index = result.index
    row.confirmed_at = utcnow()
    audit.record(
        db,
        "audit.anchored",
        actor=actor,
        entity_type="anchor",
        entity_id=row.id,
        details={
            "audit_log_id": head.id,
            "entry_hash": head.entry_hash,
            "chain_id": client.chain_id,
            "tx_hash": result.tx_hash,
        },
    )
    db.commit()
    return row


def maybe_anchor(db: Session, client: AnchorClient) -> BlockchainAnchor | None:
    """Scheduler hook: anchor if critical events happened since the last anchor and the
    minimum interval has passed."""
    wait = timedelta(seconds=get_settings().anchor_min_interval_seconds)
    latest = db.execute(
        select(BlockchainAnchor).order_by(BlockchainAnchor.id.desc()).limit(1)
    ).scalar_one_or_none()
    # Rate limit successes and failures alike, so a down node isn't hammered every tick.
    if latest is not None and utcnow() - (latest.confirmed_at or latest.created_at) < wait:
        return None
    prev = last_anchor(db)
    since = prev.audit_log_id if prev else 0
    pending = db.execute(
        select(AuditLog.id)
        .where(AuditLog.id > since)
        .where(AuditLog.action.in_(CRITICAL_ACTIONS))
        .limit(1)
    ).first()
    if pending is None:
        return None
    return anchor_now(db, client)


def verify_anchor(db: Session, client: AnchorClient, row: BlockchainAnchor) -> dict:
    """Compare the on-chain record with the database and the recomputed chain."""
    if row.status != AnchorStatus.CONFIRMED or row.onchain_index is None:
        return {"valid": False, "reason": f"anchor is {row.status.value}"}
    if row.chain_id != client.chain_id or (
        (row.contract_address or "").lower() != client.contract_address.lower()
    ):
        return {"valid": False, "reason": "anchor was written to a different chain or contract"}
    onchain = client.get_anchor(row.onchain_index)
    entry = db.get(AuditLog, row.audit_log_id)
    chain = audit.verify_chain(db, up_to_id=row.audit_log_id)
    checks = {
        "onchain_matches_record": onchain.head_hash == row.entry_hash
        and onchain.audit_entry_id == row.audit_log_id,
        "entry_present_and_unchanged": entry is not None and entry.entry_hash == onchain.head_hash,
        "chain_valid_up_to_anchor": chain.valid and chain.head_hash == onchain.head_hash,
    }
    return {
        "valid": all(checks.values()),
        "checks": checks,
        "onchain": {
            "head_hash": onchain.head_hash,
            "audit_entry_id": onchain.audit_entry_id,
            "anchored_at": onchain.anchored_at,
        },
        "entries_covered": chain.entries,
    }
