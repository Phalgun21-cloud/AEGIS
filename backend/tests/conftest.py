import os
import tempfile

# Must be set before the app is imported.
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["VAULT_PRIVATE_KEY_FILE"] = os.path.join(tempfile.mkdtemp(), "vault_test.pem")

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

import app.models
from app.core.security import hash_password
from app.db import Base, SessionLocal, get_db
from app.main import app
from app.models import Role, User

PASSWORD = "correct-horse-battery"
_HASH = hash_password(PASSWORD)  # bcrypt is slow; hash once


@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    # Code that opens its own sessions (scheduler, websocket) uses the test DB too.
    SessionLocal.configure(bind=engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def db(db_engine):
    with SessionLocal() as session:
        yield session


@pytest.fixture()
def client(db_engine):
    def override():
        with SessionLocal() as session:
            yield session

    app.dependency_overrides[get_db] = override
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def make_user(db):
    def _make(role: Role, email: str | None = None, name: str | None = None) -> User:
        n = db.query(User).count() + 1
        user = User(
            email=email or f"{role.value}{n}@aegis.test",
            full_name=name or f"{role.value.title()} {n}",
            password_hash=_HASH,
            role=role,
            is_active=True,
        )
        db.add(user)
        db.commit()
        return user

    return _make


@pytest.fixture()
def login(client):
    def _login(user: User) -> dict:
        r = client.post("/auth/login", data={"username": user.email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        return {"Authorization": f"Bearer {r.json()['access_token']}"}

    return _login


@pytest.fixture()
def clock(monkeypatch):
    """Controllable 'now' for every module that reads the time."""
    import app.api.candidate
    import app.api.exams
    import app.api.monitor
    import app.api.questions
    import app.services.audit
    import app.services.lifecycle
    from app.core.timeutil import utcnow

    class Clock:
        def __init__(self):
            self.now = utcnow().replace(microsecond=0)

        def advance(self, **kw):
            self.now += timedelta(**kw)

        def __call__(self):
            return self.now

    c = Clock()
    for mod in (
        app.api.candidate,
        app.api.exams,
        app.api.monitor,
        app.api.questions,
        app.services.audit,
        app.services.lifecycle,
    ):
        monkeypatch.setattr(mod, "utcnow", c)
    return c
