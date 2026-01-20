import logging
from datetime import date, datetime, timezone
from typing import Annotated, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.outfit import Outfit, OutfitItem, OutfitStatus, UserFeedback
from app.models.user import User
from app.services.recommendation_service import (
    AIRecommendationError,
    InsufficientWardrobeError,
    RecommendationService,
)
from app.services.weather_service import WeatherData
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)


def get_user_today(user: User) -> date:
    try:
        user_tz = ZoneInfo(user.timezone or "UTC")
    except Exception:
        user_tz = ZoneInfo("UTC")
    return datetime.now(timezone.utc).astimezone(user_tz).date()

router = APIRouter(prefix="/outfits", tags=["Outfits"])


class WeatherOverrideRequest(BaseModel):
    temperature: float = Field(description="Temperature in Celsius")
    feels_like: Optional[float] = Field(None, description="Feels like temperature")
    condition: str = Field(default="unknown", description="Weather condition")
    precipitation_chance: int = Field(default=0, ge=0, le=100)
    humidity: int = Field(default=50, ge=0, le=100)


class SuggestRequest(BaseModel):
    occasion: str = Field(default="casual", description="Occasion type")
    weather_override: Optional[WeatherOverrideRequest] = Field(
        None, description="Manual weather override"
    )
    exclude_items: list[UUID] = Field(default_factory=list, description="Items to exclude")
    include_items: list[UUID] = Field(default_factory=list, description="Items to include")


class OutfitItemResponse(BaseModel):
    id: UUID
    type: str
    subtype: Optional[str] = None
    name: Optional[str] = None
    primary_color: Optional[str] = None
    colors: list[str] = []
    image_path: str
    thumbnail_path: Optional[str] = None
    layer_type: Optional[str] = None
    position: int


class FeedbackSummary(BaseModel):
    rating: Optional[int] = None
    comment: Optional[str] = None
    worn_at: Optional[date] = None


class OutfitResponse(BaseModel):
    id: UUID
    occasion: str
    scheduled_for: date
    status: str
    source: str
    reasoning: Optional[str] = None
    style_notes: Optional[str] = None
    highlights: Optional[list[str]] = None
    weather: Optional[dict] = None
    items: list[OutfitItemResponse]
    feedback: Optional[FeedbackSummary] = None
    created_at: datetime


class OutfitListResponse(BaseModel):
    outfits: list[OutfitResponse]
    total: int
    page: int
    page_size: int
    has_more: bool


class FeedbackRequest(BaseModel):
    accepted: Optional[bool] = Field(None, description="Whether outfit was accepted")
    rating: Optional[int] = Field(None, ge=1, le=5, description="Overall rating 1-5")
    comfort_rating: Optional[int] = Field(None, ge=1, le=5, description="Comfort rating 1-5")
    style_rating: Optional[int] = Field(None, ge=1, le=5, description="Style rating 1-5")
    comment: Optional[str] = Field(None, max_length=1000, description="Optional comment")
    worn: Optional[bool] = Field(None, description="Whether the outfit was worn")
    worn_with_modifications: Optional[bool] = Field(None, description="If worn, whether modifications were made")
    modification_notes: Optional[str] = Field(None, max_length=500)


class FeedbackResponse(BaseModel):
    id: UUID
    outfit_id: UUID
    accepted: Optional[bool] = None
    rating: Optional[int] = None
    comfort_rating: Optional[int] = None
    style_rating: Optional[int] = None
    comment: Optional[str] = None
    worn_at: Optional[date] = None
    worn_with_modifications: bool = False
    modification_notes: Optional[str] = None
    created_at: datetime


def outfit_to_response(outfit: Outfit) -> OutfitResponse:
    items = []
    for outfit_item in sorted(outfit.items, key=lambda x: x.position):
        item = outfit_item.item
        items.append(
            OutfitItemResponse(
                id=item.id,
                type=item.type,
                subtype=item.subtype,
                name=item.name,
                primary_color=item.primary_color,
                colors=item.colors or [],
                image_path=item.image_path,
                thumbnail_path=item.thumbnail_path,
                layer_type=outfit_item.layer_type,
                position=outfit_item.position,
            )
        )

    # Build feedback summary if feedback exists
    feedback_summary = None
    if outfit.feedback:
        feedback_summary = FeedbackSummary(
            rating=outfit.feedback.rating,
            comment=outfit.feedback.comment,
            worn_at=outfit.feedback.worn_at,
        )

    # Extract highlights from ai_raw_response if available
    highlights = None
    if outfit.ai_raw_response and isinstance(outfit.ai_raw_response, dict):
        raw_highlights = outfit.ai_raw_response.get("highlights")
        if raw_highlights and isinstance(raw_highlights, list):
            highlights = raw_highlights

    return OutfitResponse(
        id=outfit.id,
        occasion=outfit.occasion,
        scheduled_for=outfit.scheduled_for,
        status=outfit.status.value,
        source=outfit.source.value,
        reasoning=outfit.reasoning,
        style_notes=outfit.style_notes,
        highlights=highlights,
        weather=outfit.weather_data,
        items=items,
        feedback=feedback_summary,
        created_at=outfit.created_at,
    )


@router.post("/suggest", response_model=OutfitResponse)
async def suggest_outfit(
    request: SuggestRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    # Convert weather override to WeatherData if provided
    weather_override = None
    if request.weather_override:
        w = request.weather_override
        weather_override = WeatherData(
            temperature=w.temperature,
            feels_like=w.feels_like or w.temperature,
            humidity=w.humidity,
            precipitation_chance=w.precipitation_chance,
            precipitation_mm=0,
            wind_speed=0,
            condition=w.condition,
            condition_code=0,
            is_day=True,
            uv_index=0,
            timestamp=datetime.utcnow(),
        )

    service = RecommendationService(db)

    try:
        outfit = await service.generate_recommendation(
            user=current_user,
            occasion=request.occasion,
            weather_override=weather_override,
            exclude_items=request.exclude_items,
            include_items=request.include_items,
        )
    except InsufficientWardrobeError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )
    except AIRecommendationError as e:
        logger.error(f"AI recommendation error: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )

    return outfit_to_response(outfit)


@router.get("", response_model=OutfitListResponse)
async def list_outfits(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    occasion: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> OutfitListResponse:
    # Build query
    query = (
        select(Outfit)
        .where(Outfit.user_id == current_user.id)
        .options(
            selectinload(Outfit.items).selectinload(OutfitItem.item),
            selectinload(Outfit.feedback),
        )
    )

    # Apply filters
    if status_filter:
        try:
            outfit_status = OutfitStatus(status_filter)
            query = query.where(Outfit.status == outfit_status)
        except ValueError:
            pass  # Ignore invalid status

    if occasion:
        query = query.where(Outfit.occasion == occasion)

    if date_from:
        query = query.where(Outfit.scheduled_for >= date_from)

    if date_to:
        query = query.where(Outfit.scheduled_for <= date_to)

    # Get total count (apply all filters)
    count_query = select(Outfit.id).where(Outfit.user_id == current_user.id)
    if status_filter:
        try:
            outfit_status = OutfitStatus(status_filter)
            count_query = count_query.where(Outfit.status == outfit_status)
        except ValueError:
            pass
    if occasion:
        count_query = count_query.where(Outfit.occasion == occasion)
    if date_from:
        count_query = count_query.where(Outfit.scheduled_for >= date_from)
    if date_to:
        count_query = count_query.where(Outfit.scheduled_for <= date_to)

    count_result = await db.execute(count_query)
    total = len(count_result.all())

    # Apply pagination and ordering
    query = (
        query.order_by(Outfit.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    outfits = result.scalars().all()

    return OutfitListResponse(
        outfits=[outfit_to_response(o) for o in outfits],
        total=total,
        page=page,
        page_size=page_size,
        has_more=(page * page_size) < total,
    )


@router.get("/{outfit_id}", response_model=OutfitResponse)
async def get_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(
            selectinload(Outfit.items).selectinload(OutfitItem.item),
            selectinload(Outfit.feedback),
        )
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outfit not found",
        )

    return outfit_to_response(outfit)


@router.post("/{outfit_id}/accept", response_model=OutfitResponse)
async def accept_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(
            selectinload(Outfit.items).selectinload(OutfitItem.item),
            selectinload(Outfit.feedback),
        )
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outfit not found",
        )

    outfit.status = OutfitStatus.accepted
    outfit.responded_at = datetime.utcnow()
    await db.commit()
    await db.refresh(outfit)

    return outfit_to_response(outfit)


@router.post("/{outfit_id}/reject", response_model=OutfitResponse)
async def reject_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OutfitResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(
            selectinload(Outfit.items).selectinload(OutfitItem.item),
            selectinload(Outfit.feedback),
        )
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outfit not found",
        )

    outfit.status = OutfitStatus.rejected
    outfit.responded_at = datetime.utcnow()
    await db.commit()
    await db.refresh(outfit)

    return outfit_to_response(outfit)


@router.delete("/{outfit_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_outfit(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> None:
    query = select(Outfit).where(
        and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id)
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outfit not found",
        )

    await db.delete(outfit)
    await db.commit()


@router.post("/{outfit_id}/feedback", response_model=FeedbackResponse)
async def submit_feedback(
    outfit_id: UUID,
    request: FeedbackRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FeedbackResponse:
    # Get outfit with feedback
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(selectinload(Outfit.feedback), selectinload(Outfit.items).selectinload(OutfitItem.item))
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outfit not found",
        )

    # Create or update feedback
    if outfit.feedback:
        feedback = outfit.feedback
    else:
        feedback = UserFeedback(outfit_id=outfit.id)
        db.add(feedback)

    # Update fields if provided
    if request.accepted is not None:
        feedback.accepted = request.accepted
        outfit.status = OutfitStatus.accepted if request.accepted else OutfitStatus.rejected
        outfit.responded_at = datetime.utcnow()

    if request.rating is not None:
        feedback.rating = request.rating
    if request.comfort_rating is not None:
        feedback.comfort_rating = request.comfort_rating
    if request.style_rating is not None:
        feedback.style_rating = request.style_rating
    if request.comment is not None:
        feedback.comment = request.comment
    if request.worn and not feedback.worn_at:
        # Only increment wear counts if not already marked as worn (idempotency)
        user_today = get_user_today(current_user)
        feedback.worn_at = user_today
        for outfit_item in outfit.items:
            outfit_item.item.wear_count += 1
            outfit_item.item.last_worn_at = user_today
    if request.worn_with_modifications is not None:
        feedback.worn_with_modifications = request.worn_with_modifications
    if request.modification_notes is not None:
        feedback.modification_notes = request.modification_notes

    await db.commit()
    await db.refresh(feedback)

    return FeedbackResponse(
        id=feedback.id,
        outfit_id=feedback.outfit_id,
        accepted=feedback.accepted,
        rating=feedback.rating,
        comfort_rating=feedback.comfort_rating,
        style_rating=feedback.style_rating,
        comment=feedback.comment,
        worn_at=feedback.worn_at,
        worn_with_modifications=feedback.worn_with_modifications,
        modification_notes=feedback.modification_notes,
        created_at=feedback.created_at,
    )


@router.get("/{outfit_id}/feedback", response_model=FeedbackResponse)
async def get_feedback(
    outfit_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> FeedbackResponse:
    query = (
        select(Outfit)
        .where(and_(Outfit.id == outfit_id, Outfit.user_id == current_user.id))
        .options(selectinload(Outfit.feedback))
    )

    result = await db.execute(query)
    outfit = result.scalar_one_or_none()

    if not outfit:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Outfit not found",
        )

    if not outfit.feedback:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No feedback found for this outfit",
        )

    feedback = outfit.feedback
    return FeedbackResponse(
        id=feedback.id,
        outfit_id=feedback.outfit_id,
        accepted=feedback.accepted,
        rating=feedback.rating,
        comfort_rating=feedback.comfort_rating,
        style_rating=feedback.style_rating,
        comment=feedback.comment,
        worn_at=feedback.worn_at,
        worn_with_modifications=feedback.worn_with_modifications,
        modification_notes=feedback.modification_notes,
        created_at=feedback.created_at,
    )
