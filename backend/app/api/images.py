from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.services.family_service import FamilyService
from app.services.image_service import ImageService
from app.utils.auth import get_current_user

router = APIRouter(prefix="/images", tags=["Images"])


@router.get("/{user_id}/{filename}")
async def get_image(
    user_id: str,
    filename: str,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FileResponse:
    """Serve an image file.

    Users can access their own images and images of family members.
    """
    # Verify user has access to this image
    can_access = str(current_user.id) == user_id

    # Also allow access to family members' images
    if not can_access and current_user.family_id:
        family_service = FamilyService(db)
        family_members = await family_service.get_family_members(current_user.family_id)
        family_user_ids = [str(m.id) for m in family_members]
        can_access = user_id in family_user_ids

    if not can_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )

    image_service = ImageService()
    image_path = image_service.get_image_path(f"{user_id}/{filename}")

    if not image_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found",
        )

    return FileResponse(
        path=str(image_path),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000"},
    )
