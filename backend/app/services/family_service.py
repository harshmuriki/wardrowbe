import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.family import Family, FamilyInvite
from app.models.user import User
from app.schemas.family import FamilyCreate, FamilyUpdate, InviteMemberRequest


def generate_invite_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    # Remove ambiguous characters
    alphabet = alphabet.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def generate_invite_token() -> str:
    return secrets.token_urlsafe(32)


class FamilyService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, family_id: UUID) -> Optional[Family]:
        result = await self.db.execute(
            select(Family)
            .where(Family.id == family_id)
            .options(selectinload(Family.members), selectinload(Family.invites))
        )
        return result.scalar_one_or_none()

    async def get_by_invite_code(self, invite_code: str) -> Optional[Family]:
        result = await self.db.execute(
            select(Family).where(Family.invite_code == invite_code.upper())
        )
        return result.scalar_one_or_none()

    async def get_user_family(self, user: User) -> Optional[Family]:
        """Get the family a user belongs to with members and invites."""
        if user.family_id is None:
            return None
        return await self.get_by_id(user.family_id)

    async def create(self, user: User, family_data: FamilyCreate) -> Family:
        """Create a new family with the user as admin."""
        # Generate unique invite code
        invite_code = generate_invite_code()
        while await self.get_by_invite_code(invite_code):
            invite_code = generate_invite_code()

        family = Family(
            name=family_data.name,
            created_by=user.id,
            invite_code=invite_code,
        )
        self.db.add(family)
        await self.db.flush()

        # Update user to be admin of this family
        user.family_id = family.id
        user.role = "admin"
        await self.db.flush()
        await self.db.refresh(family)

        return family

    async def update(self, family: Family, family_data: FamilyUpdate) -> Family:
        """Update family details."""
        update_data = family_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(family, field, value)
        await self.db.flush()
        await self.db.refresh(family)
        return family

    async def regenerate_invite_code(self, family: Family) -> str:
        """Generate a new invite code for the family."""
        new_code = generate_invite_code()
        while await self.get_by_invite_code(new_code):
            new_code = generate_invite_code()

        family.invite_code = new_code
        await self.db.flush()
        return new_code

    async def join_family(self, user: User, invite_code: str) -> Optional[Family]:
        """
        Join a family using invite code.
        Returns the family if successful, None if code invalid.
        """
        family = await self.get_by_invite_code(invite_code)
        if family is None:
            return None

        user.family_id = family.id
        user.role = "member"
        await self.db.flush()

        return family

    async def leave_family(self, user: User) -> bool:
        """
        Leave current family.
        Returns False if user is the only admin.
        """
        if user.family_id is None:
            return True

        # Check if user is the only admin
        if user.role == "admin":
            family = await self.get_by_id(user.family_id)
            if family:
                admin_count = sum(1 for m in family.members if m.role == "admin")
                if admin_count <= 1 and len(family.members) > 1:
                    # Cannot leave if only admin with other members
                    return False

                # If last member, could delete family (optional behavior)
                if len(family.members) == 1:
                    # Delete the family since no one else is in it
                    await self.db.delete(family)

        user.family_id = None
        user.role = "member"
        await self.db.flush()
        return True

    async def remove_member(self, family: Family, member_id: UUID) -> bool:
        """Remove a member from the family."""
        result = await self.db.execute(
            select(User).where(User.id == member_id, User.family_id == family.id)
        )
        member = result.scalar_one_or_none()

        if member is None:
            return False

        member.family_id = None
        member.role = "member"
        await self.db.flush()
        return True

    async def update_member_role(
        self, family: Family, member_id: UUID, new_role: str
    ) -> Optional[User]:
        """Update a member's role."""
        result = await self.db.execute(
            select(User).where(User.id == member_id, User.family_id == family.id)
        )
        member = result.scalar_one_or_none()

        if member is None:
            return None

        member.role = new_role
        await self.db.flush()
        await self.db.refresh(member)
        return member

    async def create_invite(
        self, family: Family, inviter: User, invite_data: InviteMemberRequest
    ) -> FamilyInvite:
        """Create an email invitation."""
        # Check if invite already exists for this email
        result = await self.db.execute(
            select(FamilyInvite).where(
                FamilyInvite.family_id == family.id,
                FamilyInvite.email == invite_data.email,
                FamilyInvite.accepted_at.is_(None),
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            # Update expiration
            existing.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
            existing.token = generate_invite_token()
            await self.db.flush()
            await self.db.refresh(existing)
            return existing

        invite = FamilyInvite(
            family_id=family.id,
            email=invite_data.email,
            token=generate_invite_token(),
            invited_by=inviter.id,
            role=invite_data.role,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        )
        self.db.add(invite)
        await self.db.flush()
        await self.db.refresh(invite)
        return invite

    async def get_invite_by_id(self, invite_id: UUID) -> Optional[FamilyInvite]:
        """Get an invite by ID."""
        result = await self.db.execute(
            select(FamilyInvite).where(FamilyInvite.id == invite_id)
        )
        return result.scalar_one_or_none()

    async def cancel_invite(self, invite: FamilyInvite) -> None:
        """Cancel/delete an invite."""
        await self.db.delete(invite)
        await self.db.flush()

    async def get_pending_invites(self, family: Family) -> list[FamilyInvite]:
        """Get all pending (non-expired, non-accepted) invites for a family."""
        result = await self.db.execute(
            select(FamilyInvite).where(
                FamilyInvite.family_id == family.id,
                FamilyInvite.accepted_at.is_(None),
                FamilyInvite.expires_at > datetime.now(timezone.utc),
            )
        )
        return list(result.scalars().all())
