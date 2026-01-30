from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas.user import UserResponse, UserSyncRequest, UserSyncResponse
from app.services.user_service import UserEmailConflictError, UserService
from app.utils.auth import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()


def create_access_token(external_id: str, expires_delta: timedelta | None = None) -> str:
    now = datetime.utcnow()
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(days=7)
    to_encode = {
        "sub": external_id,
        "exp": expire,
        "iat": now,
    }
    return jwt.encode(to_encode, settings.secret_key, algorithm="HS256")


@router.post("/sync", response_model=UserSyncResponse)
async def sync_user(
    sync_data: UserSyncRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> UserSyncResponse:
    """
    Sync user from OIDC provider.

    Called by frontend after successful OIDC authentication to ensure
    user exists in local database. Returns a JWT token for API authentication.
    """
    user_service = UserService(db)

    try:
        user, is_new = await user_service.sync_from_oidc(sync_data)
    except UserEmailConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e),
        ) from e

    # Generate JWT token for API authentication
    access_token = create_access_token(user.external_id)

    return UserSyncResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        is_new_user=is_new,
        onboarding_completed=user.onboarding_completed,
        access_token=access_token,
    )


@router.get("/session", response_model=UserResponse)
async def get_session(
    current_user: Annotated[User, Depends(get_current_user)],
) -> UserResponse:
    return UserResponse.model_validate(current_user)
