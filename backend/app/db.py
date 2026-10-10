import tempfile
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def mysql_connect_args() -> dict:
    """TLS for managed MySQL: verify the server against the provider's CA certificate."""
    # Accepts real newlines or literal "\n" escapes (single-line env var values).
    pem = get_settings().database_ssl_ca.strip().replace("\\n", "\n")
    if not pem:
        return {}
    path = Path(tempfile.gettempdir()) / "aegis_db_ca.pem"
    path.write_text(pem + "\n", encoding="utf-8")
    return {"ssl": {"ca": str(path)}}


def _make_engine():
    s = get_settings()
    if s.database_url in ("sqlite://", "sqlite:///:memory:"):
        return create_engine(s.database_url)  # unit tests
    if s.database_url.startswith("sqlite"):
        # Throwaway runs (load test): wait for SQLite's single writer instead of failing.
        eng = create_engine(
            s.database_url,
            connect_args={"timeout": 60},
            pool_size=s.db_pool_size,
            max_overflow=s.db_max_overflow,
        )

        @event.listens_for(eng, "connect")
        def _wal(dbapi_conn, _record):  # readers no longer wait behind the writer
            dbapi_conn.execute("PRAGMA journal_mode=WAL")

        return eng
    return create_engine(
        s.database_url,
        pool_pre_ping=True,
        pool_size=s.db_pool_size,
        max_overflow=s.db_max_overflow,
        pool_recycle=1800,  # below MySQL's (and managed hosts') idle-connection timeouts
        connect_args=mysql_connect_args(),
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
