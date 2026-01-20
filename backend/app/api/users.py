from decimal import Decimal
from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.user_service import UserService
from app.utils.auth import get_current_user

router = APIRouter(prefix="/users/me", tags=["Users"])


class OnboardingCompleteResponse(BaseModel):
    onboarding_completed: bool


class UserProfileResponse(BaseModel):
    id: str
    email: str
    display_name: str
    avatar_url: Optional[str] = None
    timezone: str
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None
    location_name: Optional[str] = None
    family_id: Optional[str] = None
    role: str
    onboarding_completed: bool


class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    timezone: Optional[str] = None
    location_lat: Optional[Decimal] = None
    location_lon: Optional[Decimal] = None
    location_name: Optional[str] = None


@router.get("", response_model=UserProfileResponse)
async def get_profile(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserProfileResponse:
    return UserProfileResponse(
        id=str(current_user.id),
        email=current_user.email,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        timezone=current_user.timezone,
        location_lat=float(current_user.location_lat) if current_user.location_lat else None,
        location_lon=float(current_user.location_lon) if current_user.location_lon else None,
        location_name=current_user.location_name,
        family_id=str(current_user.family_id) if current_user.family_id else None,
        role=current_user.role,
        onboarding_completed=current_user.onboarding_completed,
    )


@router.patch("", response_model=UserProfileResponse)
async def update_profile(
    data: UserProfileUpdate,
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserProfileResponse:
    # Build update dict from non-None values
    update_data = data.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(current_user, field, value)

    await db.flush()
    await db.refresh(current_user)
    await db.commit()

    return UserProfileResponse(
        id=str(current_user.id),
        email=current_user.email,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        timezone=current_user.timezone,
        location_lat=float(current_user.location_lat) if current_user.location_lat else None,
        location_lon=float(current_user.location_lon) if current_user.location_lon else None,
        location_name=current_user.location_name,
        family_id=str(current_user.family_id) if current_user.family_id else None,
        role=current_user.role,
        onboarding_completed=current_user.onboarding_completed,
    )


@router.post("/onboarding/complete", response_model=OnboardingCompleteResponse)
async def complete_onboarding(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> OnboardingCompleteResponse:
    user_service = UserService(db)
    await user_service.complete_onboarding(current_user)
    await db.commit()

    return OnboardingCompleteResponse(onboarding_completed=True)
