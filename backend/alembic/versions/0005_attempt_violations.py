"""proctoring: violation and noise counts, latest webcam snapshot on attempts

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-17
"""

import sqlalchemy as sa
from sqlalchemy.dialects import mysql

from alembic import op

BLOB = sa.LargeBinary().with_variant(mysql.MEDIUMBLOB(), "mysql")

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("attempts") as batch:
        batch.add_column(
            sa.Column("violations", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("last_violation_at", sa.DateTime(), nullable=True))
        batch.add_column(
            sa.Column("noise_flags", sa.Integer(), nullable=False, server_default="0")
        )
        batch.add_column(sa.Column("snapshot", BLOB, nullable=True))
        batch.add_column(sa.Column("snapshot_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("attempts") as batch:
        batch.drop_column("snapshot_at")
        batch.drop_column("snapshot")
        batch.drop_column("noise_flags")
        batch.drop_column("last_violation_at")
        batch.drop_column("violations")
