import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.preference import UserPreference
from app.schemas.preference import PreferenceCreate, PreferenceUpdate


class PreferenceService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_preferences(self, user_id: uuid.UUID) -> Optional[UserPreference]:
        result = await self.db.execute(
            select(UserPreference).where(UserPreference.user_id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_or_create_preferences(self, user_id: uuid.UUID) -> UserPreference:
        preferences = await self.get_preferences(user_id)
        if preferences:
            return preferences

        # Create default preferences
        preferences = UserPreference(
            user_id=user_id,
            color_favorites=[],
            color_avoid=[],
            style_profile={
                "casual": 50,
                "formal": 50,
                "sporty": 50,
                "minimalist": 50,
                "bold": 50,
            },
            default_occasion="casual",
            temperature_sensitivity="normal",
            cold_threshold=10,
            hot_threshold=25,
            layering_preference="moderate",
            avoid_repeat_days=7,
            prefer_underused_items=True,
            variety_level="moderate",
            excluded_item_ids=[],
            excluded_combinations=[],
        )
        self.db.add(preferences)
        await self.db.commit()
        await self.db.refresh(preferences)
        return preferences

    async def update_preferences(
        self, user_id: uuid.UUID, data: PreferenceUpdate
    ) -> UserPreference:
        preferences = await self.get_or_create_preferences(user_id)

        update_data = data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if field == "style_profile" and value is not None:
                # Merge style profile updates with existing
                # Create a NEW dict to ensure SQLAlchemy detects the change
                current_profile = dict(preferences.style_profile or {})
                update_value = value.model_dump() if hasattr(value, "model_dump") else value
                current_profile.update(update_value)
                preferences.style_profile = current_profile
                flag_modified(preferences, "style_profile")
            elif field in ("color_favorites", "color_avoid", "excluded_item_ids", "excluded_combinations"):
                # JSONB array fields also need flag_modified
                setattr(preferences, field, value)
                flag_modified(preferences, field)
            else:
                setattr(preferences, field, value)

        await self.db.commit()
        await self.db.refresh(preferences)
        return preferences

    async def reset_preferences(self, user_id: uuid.UUID) -> UserPreference:
        preferences = await self.get_preferences(user_id)
        if preferences:
            await self.db.delete(preferences)
            await self.db.commit()

        return await self.get_or_create_preferences(user_id)

    async def add_excluded_item(
        self, user_id: uuid.UUID, item_id: uuid.UUID
    ) -> UserPreference:
        preferences = await self.get_or_create_preferences(user_id)
        if item_id not in preferences.excluded_item_ids:
            preferences.excluded_item_ids = [*preferences.excluded_item_ids, item_id]
            flag_modified(preferences, "excluded_item_ids")
            await self.db.commit()
            await self.db.refresh(preferences)
        return preferences

    async def remove_excluded_item(
        self, user_id: uuid.UUID, item_id: uuid.UUID
    ) -> UserPreference:
        preferences = await self.get_or_create_preferences(user_id)
        if item_id in preferences.excluded_item_ids:
            preferences.excluded_item_ids = [
                i for i in preferences.excluded_item_ids if i != item_id
            ]
            flag_modified(preferences, "excluded_item_ids")
            await self.db.commit()
            await self.db.refresh(preferences)
        return preferences
