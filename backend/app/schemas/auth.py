from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class TokenPayload(BaseModel):
    sub: str  # Subject (external_id from OIDC)
    exp: int  # Expiration timestamp
    iat: int  # Issued at timestamp
    email: Optional[str] = None
    name: Optional[str] = None


class AuthSession(BaseModel):
    user_id: UUID
    external_id: str
    email: str
    display_name: str
    family_id: Optional[UUID] = None
    role: str
    is_authenticated: bool = True
