from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.item import ClothingItem, ItemHistory, ItemStatus
from app.schemas.item import ItemCreate, ItemFilter, ItemUpdate


class ItemService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_by_id(self, item_id: UUID, user_id: UUID) -> Optional[ClothingItem]:
        result = await self.db.execute(
            select(ClothingItem).where(
                and_(ClothingItem.id == item_id, ClothingItem.user_id == user_id)
            )
        )
        return result.scalar_one_or_none()

    async def get_list(
        self,
        user_id: UUID,
        filters: ItemFilter,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ClothingItem], int]:
        # Base query
        query = select(ClothingItem).where(ClothingItem.user_id == user_id)

        # Apply filters
        if filters.type:
            query = query.where(ClothingItem.type == filters.type)
        if filters.subtype:
            query = query.where(ClothingItem.subtype == filters.subtype)
        if filters.status:
            query = query.where(ClothingItem.status == filters.status)
        if filters.favorite is not None:
            query = query.where(ClothingItem.favorite == filters.favorite)
        if filters.colors:
            query = query.where(ClothingItem.colors.overlap(filters.colors))

        # Archive filter
        query = query.where(ClothingItem.is_archived == filters.is_archived)

        # Search filter
        if filters.search:
            search_term = f"%{filters.search}%"
            query = query.where(
                or_(
                    ClothingItem.name.ilike(search_term),
                    ClothingItem.brand.ilike(search_term),
                    ClothingItem.type.ilike(search_term),
                    ClothingItem.notes.ilike(search_term),
                )
            )

        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply pagination and ordering
        query = query.order_by(ClothingItem.created_at.desc())
        query = query.offset((page - 1) * page_size).limit(page_size)

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        return items, total

    async def get_ids_by_filter(
        self,
        user_id: UUID,
        type_filter: Optional[str] = None,
        search: Optional[str] = None,
        is_archived: bool = False,
        excluded_ids: Optional[list[UUID]] = None,
    ) -> list[UUID]:
        query = select(ClothingItem.id).where(ClothingItem.user_id == user_id)

        if type_filter:
            query = query.where(ClothingItem.type == type_filter)

        query = query.where(ClothingItem.is_archived == is_archived)

        if search:
            search_term = f"%{search}%"
            query = query.where(
                or_(
                    ClothingItem.name.ilike(search_term),
                    ClothingItem.brand.ilike(search_term),
                    ClothingItem.type.ilike(search_term),
                    ClothingItem.notes.ilike(search_term),
                )
            )

        if excluded_ids:
            query = query.where(ClothingItem.id.notin_(excluded_ids))

        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def find_duplicate_by_hash(
        self,
        user_id: UUID,
        image_hash: str,
        threshold: int = 8,
    ) -> Optional[ClothingItem]:
        """
        Find an existing item with a similar image hash.

        Uses exact match for now. For fuzzy matching with Hamming distance,
        we would need to load all hashes and compare - expensive for large wardrobes.
        Exact match catches identical/near-identical uploads.
        """
        # For exact duplicate detection (same hash)
        result = await self.db.execute(
            select(ClothingItem).where(
                and_(
                    ClothingItem.user_id == user_id,
                    ClothingItem.image_hash == image_hash,
                    ClothingItem.is_archived == False,
                )
            )
        )
        return result.scalar_one_or_none()

    async def create(
        self,
        user_id: UUID,
        item_data: ItemCreate,
        image_paths: dict[str, str],
    ) -> ClothingItem:
        # Build tags dict
        tags = {}
        if item_data.tags:
            tags = item_data.tags.model_dump(exclude_none=True)

        # Create item
        item = ClothingItem(
            user_id=user_id,
            image_path=image_paths["image_path"],
            thumbnail_path=image_paths.get("thumbnail_path"),
            medium_path=image_paths.get("medium_path"),
            image_hash=image_paths.get("image_hash"),
            type=item_data.type,
            subtype=item_data.subtype,
            tags=tags,
            colors=item_data.colors or [],
            primary_color=item_data.primary_color,
            status=ItemStatus.processing,  # AI analysis will update to ready
            name=item_data.name,
            brand=item_data.brand,
            notes=item_data.notes,
            purchase_date=item_data.purchase_date,
            purchase_price=item_data.purchase_price,
            favorite=item_data.favorite,
        )

        self.db.add(item)
        await self.db.flush()
        await self.db.refresh(item)
        return item

    async def update(self, item: ClothingItem, item_data: ItemUpdate) -> ClothingItem:
        update_data = item_data.model_dump(exclude_unset=True)

        # Handle tags specially
        if "tags" in update_data and update_data["tags"]:
            update_data["tags"] = update_data["tags"].model_dump(exclude_none=True)

        for field, value in update_data.items():
            setattr(item, field, value)

        await self.db.flush()
        await self.db.refresh(item)
        return item

    async def delete(self, item: ClothingItem) -> None:
        await self.db.delete(item)
        await self.db.flush()

    async def archive(
        self,
        item: ClothingItem,
        reason: Optional[str] = None,
    ) -> ClothingItem:
        item.is_archived = True
        item.archived_at = datetime.now(timezone.utc)
        item.archive_reason = reason
        item.status = ItemStatus.archived
        await self.db.flush()
        await self.db.refresh(item)
        return item

    async def restore(self, item: ClothingItem) -> ClothingItem:
        item.is_archived = False
        item.archived_at = None
        item.archive_reason = None
        item.status = ItemStatus.ready
        await self.db.flush()
        await self.db.refresh(item)
        return item

    async def log_wear(
        self,
        item: ClothingItem,
        worn_at: date,
        occasion: Optional[str] = None,
        notes: Optional[str] = None,
        outfit_id: Optional[UUID] = None,
    ) -> ItemHistory:
        # Create history entry
        history = ItemHistory(
            item_id=item.id,
            outfit_id=outfit_id,
            worn_at=worn_at,
            occasion=occasion,
            notes=notes,
        )
        self.db.add(history)

        # Update item stats
        item.wear_count += 1
        item.last_worn_at = worn_at

        await self.db.flush()
        await self.db.refresh(history)
        return history

    async def get_wear_history(
        self,
        item_id: UUID,
        limit: int = 10,
    ) -> list[ItemHistory]:
        result = await self.db.execute(
            select(ItemHistory)
            .where(ItemHistory.item_id == item_id)
            .order_by(ItemHistory.worn_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def get_item_types(self, user_id: UUID) -> list[dict]:
        result = await self.db.execute(
            select(ClothingItem.type, func.count(ClothingItem.id).label("count"))
            .where(
                and_(
                    ClothingItem.user_id == user_id,
                    ClothingItem.is_archived == False,  # noqa: E712
                )
            )
            .group_by(ClothingItem.type)
            .order_by(func.count(ClothingItem.id).desc())
        )
        return [{"type": row.type, "count": row.count} for row in result.all()]

    async def get_color_distribution(self, user_id: UUID) -> list[dict]:
        result = await self.db.execute(
            select(
                func.unnest(ClothingItem.colors).label("color"),
                func.count().label("count"),
            )
            .where(
                and_(
                    ClothingItem.user_id == user_id,
                    ClothingItem.is_archived == False,  # noqa: E712
                )
            )
            .group_by("color")
            .order_by(func.count().desc())
        )
        return [{"color": row.color, "count": row.count} for row in result.all()]
