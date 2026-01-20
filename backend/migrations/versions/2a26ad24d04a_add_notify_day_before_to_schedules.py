"""add_notify_day_before_to_schedules

Revision ID: 2a26ad24d04a
Revises: add_image_hash
Create Date: 2026-01-18 03:35:09.778149

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2a26ad24d04a'
down_revision: Union[str, None] = 'add_image_hash'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'schedules',
        sa.Column('notify_day_before', sa.Boolean(), nullable=False, server_default='false')
    )


def downgrade() -> None:
    op.drop_column('schedules', 'notify_day_before')
