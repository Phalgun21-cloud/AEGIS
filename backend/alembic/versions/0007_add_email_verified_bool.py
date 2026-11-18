"""add email_verified boolean column to users

Adds the email_verified boolean flag (default False).
Existing rows get email_verified = TRUE if email_verified_at is set,
otherwise FALSE.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-18
"""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("email_verified", sa.Boolean(), nullable=False, server_default="0"))
    # Mark existing accounts (from 0006 migration) as verified
    op.execute("UPDATE users SET email_verified = 1 WHERE email_verified_at IS NOT NULL")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("email_verified")
