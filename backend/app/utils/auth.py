from typing import Annotated, Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas.auth import AuthSession, TokenPayload
from app.services.user_service import UserService

settings = get_settings()

# HTTP Bearer token scheme
bearer_scheme = HTTPBearer(auto_error=False)

# Forward auth header names (TinyAuth, Authelia, Authentik, etc.)
REMOTE_USER_HEADER = "Remote-User"
REMOTE_EMAIL_HEADER = "Remote-Email"
REMOTE_NAME_HEADER = "Remote-Name"


def decode_token(token: str) -> TokenPayload:
    """
    Decode and validate JWT token.

    Note: In production with Authentik, you would validate against
    the OIDC provider's public keys (JWKS). For simplicity, we're
    using a shared secret here.
    """
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            options={"verify_exp": True},
        )
        return TokenPayload(**payload)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user_optional(
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Optional[User]:
    """
    Get current user from JWT token if provided.
    Returns None if no token or invalid token.
    """
    if not credentials:
        return None

    try:
        token_data = decode_token(credentials.credentials)
        user_service = UserService(db)
        return await user_service.get_by_external_id(token_data.sub)
    except HTTPException:
        return None


async def get_current_user(
    request: Request,
    credentials: Annotated[Optional[HTTPAuthorizationCredentials], Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """
    Get current authenticated user.

    Supports two authentication methods:
    1. Forward auth headers (TinyAuth, Authelia, etc.) - Remote-User header
    2. JWT Bearer token

    Forward auth headers take precedence when AUTH_TRUST_HEADER is enabled.
    """
    user_service = UserService(db)
    user = None

    # Method 1: Check forward auth headers (TinyAuth, Authelia, Authentik)
    # These headers are set by nginx after successful auth_request
    if settings.auth_trust_header:
        remote_user = request.headers.get(REMOTE_USER_HEADER)
        remote_email = request.headers.get(REMOTE_EMAIL_HEADER)
        remote_name = request.headers.get(REMOTE_NAME_HEADER)

        if remote_user:
            # Try to find user by username/email
            user = await user_service.get_by_external_id(remote_user)

            if not user and remote_email:
                # Try by email
                user = await user_service.get_by_email(remote_email)

            # Sync user data from forward auth headers
            # This creates new users and updates existing ones
            from app.schemas.user import UserSyncRequest
            sync_data = UserSyncRequest(
                external_id=remote_user,
                email=remote_email or (user.email if user else f"{remote_user}@example.com"),
                display_name=remote_name or (user.display_name if user else remote_user),
            )
            user, _ = await user_service.sync_from_oidc(sync_data)

    # Method 2: Fall back to JWT Bearer token
    if not user and credentials:
        token_data = decode_token(credentials.credentials)
        user = await user_service.get_by_external_id(token_data.sub)

    # No authentication provided
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    return user


async def get_current_session(
    user: Annotated[User, Depends(get_current_user)],
) -> AuthSession:
    """Get current auth session from authenticated user."""
    return AuthSession(
        user_id=user.id,
        external_id=user.external_id,
        email=user.email,
        display_name=user.display_name,
        family_id=user.family_id,
        role=user.role,
    )


# Type aliases for dependency injection
CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentUserOptional = Annotated[Optional[User], Depends(get_current_user_optional)]
CurrentSession = Annotated[AuthSession, Depends(get_current_session)]
