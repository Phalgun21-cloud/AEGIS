"""Phase 4: anchoring the audit chain head on-chain (with an in-memory fake chain)."""

import pytest

from app.api.audit import anchor_client
from app.main import app
from app.models import AnchorStatus, AuditLog, BlockchainAnchor, Role
from app.services import anchor, audit
from app.services.anchor import AnchorError, OnChainAnchor, TxResult


class FakeChain:
    chain_id = 31337
    contract_address = "0x5FbDB2315678afecb367f032d93F642f64180aa3"

    def __init__(self):
        self.anchors: list[OnChainAnchor] = []
        self.fail = False

    def anchor(self, head_hash: str, audit_entry_id: int) -> TxResult:
        if self.fail:
            raise ConnectionError("node unreachable")
        if self.anchors and audit_entry_id <= self.anchors[-1].audit_entry_id:
            raise AnchorError("NotIncreasing")
        self.anchors.append(OnChainAnchor(head_hash, audit_entry_id, 1_700_000_000))
        n = len(self.anchors) - 1
        return TxResult(tx_hash="0x" + f"{n:064x}", block_number=100 + n, index=n)

    def get_anchor(self, index: int) -> OnChainAnchor:
        return self.anchors[index]

    def latest(self) -> OnChainAnchor | None:
        return self.anchors[-1] if self.anchors else None


@pytest.fixture()
def chain():
    return FakeChain()


def _events(db, n=3, action="paper.generated"):
    for i in range(n):
        audit.record(db, action, entity_type="exam", entity_id=i)
    db.commit()


def test_anchor_commits_current_head(db, chain):
    _events(db)
    head = db.query(AuditLog).order_by(AuditLog.id.desc()).first()
    row = anchor.anchor_now(db, chain)
    assert row.status == AnchorStatus.CONFIRMED
    assert row.audit_log_id == head.id and row.entry_hash == head.entry_hash
    assert chain.anchors[0].head_hash == head.entry_hash
    # The anchoring itself is audited (after the anchored entry).
    assert db.query(AuditLog).order_by(AuditLog.id.desc()).first().action == "audit.anchored"
    assert anchor.verify_anchor(db, chain, row)["valid"] is True


def test_already_anchored_head_is_a_no_op(db, chain, monkeypatch):
    _events(db)
    # Don't log the anchoring itself, so the head stays where it was anchored.
    monkeypatch.setattr(anchor.audit, "record", lambda *a, **k: None)
    assert anchor.anchor_now(db, chain) is not None
    assert anchor.anchor_now(db, chain) is None
    assert len(chain.anchors) == 1


def test_tampering_after_anchor_is_detected(db, chain):
    _events(db, 4)
    row = anchor.anchor_now(db, chain)
    victim = db.query(AuditLog).order_by(AuditLog.id).all()[1]
    victim.details = {"forged": True}
    db.commit()
    result = anchor.verify_anchor(db, chain, row)
    assert result["valid"] is False
    assert result["checks"]["chain_valid_up_to_anchor"] is False


def test_rewriting_whole_chain_is_detected(db, chain):
    """Even someone who recomputes every hash after editing can't match the on-chain head."""
    _events(db, 3)
    row = anchor.anchor_now(db, chain)
    entries = db.query(AuditLog).order_by(AuditLog.id).all()
    entries[0].details = {"forged": True}
    prev = audit.GENESIS
    for e in entries:
        e.prev_hash = prev
        e.entry_hash = audit._entry_hash(prev, e)
        prev = e.entry_hash
    db.commit()
    assert audit.verify_chain(db).valid  # the forged chain is internally consistent...
    result = anchor.verify_anchor(db, chain, row)
    assert result["valid"] is False  # ...but no longer matches the blockchain
    assert result["checks"]["entry_present_and_unchanged"] is False


def test_refuses_to_anchor_a_broken_chain(db, chain):
    _events(db, 3)
    db.query(AuditLog).order_by(AuditLog.id).first().details = {"x": 1}
    db.commit()
    with pytest.raises(AnchorError):
        anchor.anchor_now(db, chain)
    assert chain.anchors == []


def test_failure_is_recorded_and_rate_limited(db, chain):
    _events(db)
    chain.fail = True
    row = anchor.anchor_now(db, chain)
    assert row.status == AnchorStatus.FAILED and "unreachable" in row.error
    assert db.query(AuditLog).order_by(AuditLog.id.desc()).first().action == "audit.anchor_failed"
    # The scheduler doesn't retry immediately.
    assert anchor.maybe_anchor(db, chain) is None


def test_scheduler_anchors_only_after_critical_events(db, chain, monkeypatch):
    monkeypatch.setattr(anchor.get_settings(), "anchor_min_interval_seconds", 0)
    _events(db, 2, action="auth.login")
    assert anchor.maybe_anchor(db, chain) is None  # nothing critical yet
    _events(db, 1, action="paper.released")
    assert anchor.maybe_anchor(db, chain).status == AnchorStatus.CONFIRMED
    assert anchor.maybe_anchor(db, chain) is None  # nothing critical since


# ---------- API ----------


@pytest.fixture()
def admin_h(make_user, login):
    return login(make_user(Role.ADMIN))


def test_api_disabled_by_default(client, admin_h):
    r = client.get("/audit/anchors", headers=admin_h)
    assert r.status_code == 200 and r.json()["enabled"] is False
    assert client.post("/audit/anchors", headers=admin_h).status_code == 503


def test_api_anchor_and_verify(client, admin_h, chain, db):
    app.dependency_overrides[anchor_client] = lambda: chain
    try:
        r = client.post("/audit/anchors", headers=admin_h)
        assert r.status_code == 200 and r.json()["anchored"] is True
        aid = r.json()["anchor"]["id"]
        listing = client.get("/audit/anchors", headers=admin_h).json()
        assert listing["enabled"] and listing["chain_id"] == 31337
        assert listing["anchors"][0]["status"] == "confirmed"
        v = client.get(f"/audit/anchors/{aid}/verify", headers=admin_h).json()
        assert v["valid"] is True and all(v["checks"].values())
        assert client.get("/audit/anchors/999/verify", headers=admin_h).status_code == 404
        assert db.query(BlockchainAnchor).count() == 1
    finally:
        app.dependency_overrides.pop(anchor_client, None)


def test_api_is_admin_only(client, make_user, login):
    h = login(make_user(Role.REVIEWER))
    assert client.get("/audit/anchors", headers=h).status_code == 403
    assert client.post("/audit/anchors", headers=h).status_code == 403


def test_rolled_back_log_is_refused_before_sending(db, chain):
    """A contract ahead of the database (log rolled back, or shared contract) is reported
    clearly and no transaction is attempted."""
    _events(db, 2)
    chain.anchors.append(OnChainAnchor("ab" * 32, 50, 1_700_000_000))  # someone else's checkpoint
    row = anchor.anchor_now(db, chain)
    assert row.status == AnchorStatus.FAILED
    assert "rolled back" in row.error and "50" in row.error
    assert len(chain.anchors) == 1
