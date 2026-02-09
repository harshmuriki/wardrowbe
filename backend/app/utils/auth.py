from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import User
from app.schemas.auth import AuthSession, TokenPayload
from app.schemas.user import UserSyncRequest
from app.services.user_service import UserService

settings = get_settings()

bearer_scheme = HTTPBearer(auto_error=False)

REMOTE_USER_HEADER = "Remote-User"
REMOTE_EMAIL_HEADER = "Remote-Email"
REMOTE_NAME_HEADER = "Remote-Name"


def decode_token(token: str) -> TokenPayload:
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
            detail=f"Invalid token: {e!s}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token payload: {e!s}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None


async def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User | None:
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
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    user_service = UserService(db)
    user = None

    # Forward auth headers (TinyAuth, Authelia, etc.)
    if settings.auth_trust_header:
        remote_user = request.headers.get(REMOTE_USER_HEADER)
        remote_email = request.headers.get(REMOTE_EMAIL_HEADER)
        remote_name = request.headers.get(REMOTE_NAME_HEADER)

        if remote_user:
            user = await user_service.get_by_external_id(remote_user)

            if not user and remote_email:
                user = await user_service.get_by_email(remote_email)

            sync_data = UserSyncRequest(
                external_id=remote_user,
                email=remote_email or (user.email if user else f"{remote_user}@example.com"),
                display_name=remote_name or (user.display_name if user else remote_user),
            )
            user, _ = await user_service.sync_from_oidc(sync_data)

    # Fall back to JWT Bearer token
    if not user and credentials:
        token_data = decode_token(credentials.credentials)
        user = await user_service.get_by_external_id(token_data.sub)

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
    return AuthSession(
        user_id=user.id,
        external_id=user.external_id,
        email=user.email,
        display_name=user.display_name,
        family_id=user.family_id,
        role=user.role,
    )


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentUserOptional = Annotated[User | None, Depends(get_current_user_optional)]
CurrentSession = Annotated[AuthSession, Depends(get_current_session)]
WriteUser = CurrentUser
