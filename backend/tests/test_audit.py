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


def test_truncated_tail_breaks_chain(db):
    """Deleting the newest entries leaves a valid-looking chain; the head row catches it."""
    for i in range(3):
        audit.record(db, "test.event", details={"n": i})
    db.commit()
    db.delete(db.query(AuditLog).order_by(AuditLog.id.desc()).first())
    db.commit()
    report = audit.verify_chain(db)
    assert not report.valid and report.entries == 2


def test_rolled_back_entries_are_not_written(db):
    audit.record(db, "test.kept")
    db.commit()
    audit.record(db, "test.discarded")
    db.rollback()
    audit.record(db, "test.kept")
    db.commit()
    assert [e.action for e in db.query(AuditLog).order_by(AuditLog.id)] == ["test.kept"] * 2
    assert audit.verify_chain(db).valid


def test_concurrent_appends_keep_one_chain(tmp_path):
    """Many sessions committing at once still produce a single unbroken chain."""
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.db import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'chain.db'}", connect_args={"timeout": 30})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def write(i):
        with Session() as s:
            audit.record(s, "test.parallel", details={"n": i})
            s.commit()

    write(-1)  # creates the head row, as the migration would
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(write, range(40)))
    with Session() as s:
        report = audit.verify_chain(s)
        assert report.valid and report.entries == 41
    engine.dispose()


def test_audit_api_is_admin_only(client, make_user, login):
    from app.models import Role

    admin = login(make_user(Role.ADMIN))
    author = login(make_user(Role.AUTHOR))
    assert client.get("/audit", headers=author).status_code == 403
    r = client.get("/audit", headers=admin)
    assert r.status_code == 200
    assert {e["action"] for e in r.json()} == {"auth.login"}
    assert client.get("/audit/verify", headers=admin).json()["valid"] is True
