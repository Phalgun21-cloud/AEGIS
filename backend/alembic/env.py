from logging.config import fileConfig

from sqlalchemy import create_engine, pool

import app.models  # noqa: F401  (register models)
from alembic import context
from app.core.config import get_settings
from app.db import Base, mysql_connect_args

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url.replace("%", "%%"))
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = get_settings().database_url
    connectable = create_engine(
        url,
        poolclass=pool.NullPool,
        connect_args={} if url.startswith("sqlite") else mysql_connect_args(),
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
