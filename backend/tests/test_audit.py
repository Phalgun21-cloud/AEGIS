import itertools

from app.models import AuditLog
from app.services import audit


def test_chain_links_and_verifies(db):
    for i in range(5):
        audit.record(db, "test.event", entity_type="thing", entity_id=i, details={"n": i})
    db.commit()
    entries = db.query(AuditLog).order_by(AuditLog.id).all()
    assert entries[0].prev_hash == audit.GENESIS
    for prev, cur in itertools.pairwise(entries):
        assert cur.prev_hash == prev.entry_hash
    report = audit.verify_chain(db)
    assert report.valid and report.entries == 5


def test_edited_entry_breaks_chain(db):
    for i in range(3):
        audit.record(db, "test.event", details={"n": i})
    db.commit()
    middle = db.query(AuditLog).order_by(AuditLog.id).all()[1]
    middle.details = {"n": 999}
    db.commit()
    report = audit.verify_chain(db)
    assert not report.valid
    assert report.first_broken_id == middle.id


def test_deleted_entry_breaks_chain(db):
    for i in range(3):
        audit.record(db, "test.event", details={"n": i})
    db.commit()
    db.delete(db.query(AuditLog).order_by(AuditLog.id).all()[1])
    db.commit()
    assert not audit.verify_chain(db).valid


def test_audit_api_is_admin_only(client, make_user, login):
    from app.models import Role

    admin = login(make_user(Role.ADMIN))
    author = login(make_user(Role.AUTHOR))
    assert client.get("/audit", headers=author).status_code == 403
    r = client.get("/audit", headers=admin)
    assert r.status_code == 200
    assert {e["action"] for e in r.json()} == {"auth.login"}
    assert client.get("/audit/verify", headers=admin).json()["valid"] is True
