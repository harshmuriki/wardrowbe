from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserBase(BaseModel):
    email: EmailStr
    display_name: str = Field(..., min_length=1, max_length=100)
    avatar_url: Optional[str] = None
    timezone: str = Field(default="UTC", max_length=50)
    location_lat: Optional[Decimal] = Field(None, ge=-90, le=90)
    location_lon: Optional[Decimal] = Field(None, ge=-180, le=180)
    location_name: Optional[str] = Field(None, max_length=100)


class UserCreate(UserBase):
    external_id: str = Field(..., min_length=1, max_length=255)


class UserUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=100)
    avatar_url: Optional[str] = None
    timezone: Optional[str] = Field(None, max_length=50)
    location_lat: Optional[Decimal] = Field(None, ge=-90, le=90)
    location_lon: Optional[Decimal] = Field(None, ge=-180, le=180)
    location_name: Optional[str] = Field(None, max_length=100)


class UserResponse(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    external_id: str
    family_id: Optional[UUID] = None
    role: str
    is_active: bool
    onboarding_completed: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class UserSyncRequest(BaseModel):
    external_id: str = Field(..., description="Subject ID from OIDC provider")
    # Use str instead of EmailStr to allow system-generated emails for forward auth
    # (e.g., "username@example.com" when no real email is provided by the proxy)
    email: str = Field(..., description="Email address or system-generated placeholder")
    display_name: str = Field(..., min_length=1, max_length=100)
    avatar_url: Optional[str] = None


class UserSyncResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    display_name: str
    is_new_user: bool
    onboarding_completed: bool
    access_token: str = Field(..., description="JWT token for API authentication")


class SessionUser(BaseModel):
    id: UUID
    external_id: str
    email: str
    display_name: str
    family_id: Optional[UUID] = None
    role: str
