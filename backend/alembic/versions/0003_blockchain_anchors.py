"""blockchain anchors for the audit chain

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-09
"""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blockchain_anchors",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("audit_log_id", sa.Integer(), sa.ForeignKey("audit_logs.id"), nullable=False),
        sa.Column("entry_hash", sa.String(64), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "confirmed", "failed", name="anchorstatus"),
            nullable=False,
        ),
        sa.Column("chain_id", sa.Integer(), nullable=True),
        sa.Column("contract_address", sa.String(42), nullable=True),
        sa.Column("tx_hash", sa.String(66), nullable=True),
        sa.Column("block_number", sa.Integer(), nullable=True),
        sa.Column("onchain_index", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("confirmed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_blockchain_anchors_audit_log_id", "blockchain_anchors", ["audit_log_id"])


def downgrade() -> None:
    op.drop_index("ix_blockchain_anchors_audit_log_id", table_name="blockchain_anchors")
    op.drop_table("blockchain_anchors")
