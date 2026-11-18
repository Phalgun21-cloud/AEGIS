"""email verification: users.email_verified_at

Existing accounts are marked verified at upgrade time, so nobody already using AEGIS is
locked out; only accounts created from now on must verify their address.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-18
"""

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email_verified_at")
