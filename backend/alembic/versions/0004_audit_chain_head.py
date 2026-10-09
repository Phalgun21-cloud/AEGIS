"""audit chain head: serialises appends to the audit hash chain

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-09
"""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

GENESIS = "0" * 64


def upgrade() -> None:
    head = op.create_table(
        "audit_chain_head",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("last_entry_id", sa.Integer(), nullable=True),
        sa.Column("last_hash", sa.String(64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
    )
    # Start from the current newest entry.
    tip = (
        op.get_bind()
        .execute(sa.text("SELECT id, entry_hash FROM audit_logs ORDER BY id DESC LIMIT 1"))
        .first()
    )
    op.bulk_insert(
        head,
        [
            {
                "id": 1,
                "last_entry_id": tip[0] if tip else None,
                "last_hash": tip[1] if tip else GENESIS,
                "version": 0,
            }
        ],
    )


def downgrade() -> None:
    op.drop_table("audit_chain_head")
