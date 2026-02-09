import os

# Set test environment
os.environ["DEBUG"] = "true"
os.environ["SECRET_KEY"] = "change-me-in-production"
os.environ["STORAGE_PATH"] = "/tmp/wardrobe_test"

from collections.abc import AsyncGenerator
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api.auth import create_access_token
from app.database import Base, get_db
from app.main import app
from app.models import User, UserPreference

# Use PostgreSQL for tests (same as development, but with test prefix on tables)
# The database URL is taken from the environment, defaulting to the development database
TEST_DATABASE_URL = os.getenv(
    "TEST_DATABASE_URL",
    os.getenv("DATABASE_URL", "postgresql+asyncpg://wardrobe:wardrobe@localhost:5432/wardrobe"),
)


@pytest_asyncio.fixture(scope="function")
async def async_engine():
    """Create async engine for each test."""
    engine = create_async_engine(
        TEST_DATABASE_URL,
        echo=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def db_session(async_engine) -> AsyncGenerator[AsyncSession, None]:
    """Create a database session for each test."""
    async_session_maker = async_sessionmaker(
        async_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )

    async with async_session_maker() as session:
        yield session


@pytest_asyncio.fixture(scope="function")
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Create an async test client with database session override."""

    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def test_user(db_session: AsyncSession) -> User:
    """Create a test user with unique identifiers."""
    unique_id = uuid4()
    user = User(
        id=unique_id,
        external_id=f"test-user-{unique_id}",
        email=f"test-{unique_id}@example.com",
        display_name="Test User",
        timezone="UTC",
        is_active=True,
        onboarding_completed=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest_asyncio.fixture
async def test_user_with_preferences(db_session: AsyncSession, test_user: User) -> User:
    """Create a test user with preferences."""
    preferences = UserPreference(
        user_id=test_user.id,
        color_favorites=["black", "navy", "white"],
        color_avoid=["orange"],
    )
    db_session.add(preferences)
    await db_session.commit()
    await db_session.refresh(test_user)
    return test_user


@pytest.fixture
def auth_headers(test_user: User) -> dict[str, str]:
    """Create authorization headers for authenticated requests."""
    token = create_access_token(test_user.external_id)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sample_item_data() -> dict[str, Any]:
    """Sample data for creating a clothing item."""
    return {
        "type": "shirt",
        "subtype": "casual",
        "name": "Blue Oxford Shirt",
        "brand": "Uniqlo",
        "colors": ["blue", "white"],
        "primary_color": "blue",
        "favorite": False,
    }


@pytest.fixture
def sample_tags() -> dict[str, Any]:
    """Sample AI-generated tags."""
    return {
        "type": "shirt",
        "subtype": "oxford",
        "primary_color": "blue",
        "colors": ["blue", "white"],
        "pattern": "solid",
        "material": "cotton",
        "style": ["casual", "smart-casual"],
        "formality": "smart-casual",
        "season": ["spring", "fall", "all-season"],
        "confidence": 0.85,
    }
