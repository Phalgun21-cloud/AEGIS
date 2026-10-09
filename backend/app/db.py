from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


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
    )


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
