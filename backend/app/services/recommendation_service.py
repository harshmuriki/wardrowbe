import json
import logging
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.item import ClothingItem, ItemHistory, ItemStatus
from app.models.outfit import Outfit, OutfitItem, OutfitSource, OutfitStatus
from app.models.preference import UserPreference
from app.models.user import User
from app.services.ai_service import AIService, TextGenerationResult
from app.services.weather_service import WeatherData, WeatherServiceError, get_weather_service
from app.utils.timezone import get_user_today

logger = logging.getLogger(__name__)


@dataclass
class RecommendationContext:
    user: User
    preferences: Optional[UserPreference]
    weather: WeatherData
    occasion: str
    exclude_items: list[UUID]
    include_items: list[UUID]


# Formality mapping for occasions
OCCASION_FORMALITY = {
    "casual": ["very-casual", "casual", "smart-casual"],
    "work": ["smart-casual", "business-casual", "formal"],
    "office": ["smart-casual", "business-casual", "formal"],
    "formal": ["business-casual", "formal", "very-formal"],
    "sporty": ["very-casual", "casual"],
    "outdoor": ["very-casual", "casual"],
    "date": ["smart-casual", "business-casual", "formal"],
    "party": ["smart-casual", "business-casual", "formal"],
}

# Season mapping based on month
MONTH_TO_SEASON = {
    1: "winter",
    2: "winter",
    3: "spring",
    4: "spring",
    5: "spring",
    6: "summer",
    7: "summer",
    8: "summer",
    9: "fall",
    10: "fall",
    11: "fall",
    12: "winter",
}

RECOMMENDATION_PROMPT = """You are a fashion stylist. Pick items by their number to create one complete outfit.

OCCASION: {occasion}
WEATHER: {temperature}°C, {condition}
{preferences_text}

AVAILABLE ITEMS:
{items_text}

RULES:
- Pick exactly ONE top (shirt/blouse/sweater) + ONE bottom (pants/jeans/skirt) + ONE shoes
- OR pick ONE dress + ONE shoes
- OPTIONAL: Add ONE bag/purse if available and appropriate for the occasion
- OPTIONAL: Add accessories (belt, scarf, hat, jewelry) if they complement the outfit
- For cold/rainy weather, include outerwear (jacket/coat) if available
- Consider color coordination and occasion formality
- Return the item NUMBERS in a JSON array

Your response must be valid JSON with this structure:
{{"items": [picked numbers here], "headline": "Short catchy title for this outfit (e.g. 'Classic Casual for Mild Weather')", "highlights": ["First key point about this outfit", "Second key point", "Third key point"], "styling_tip": "Optional practical styling advice"}}"""


class RecommendationService:
    """Service for generating outfit recommendations."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.weather_service = get_weather_service()

    async def get_candidate_items(
        self,
        user: User,
        weather: WeatherData,
        occasion: str,
        preferences: Optional[UserPreference],
        exclude_items: list[UUID],
    ) -> list[ClothingItem]:
        """
        Get all available items for the user.
        Let the AI make informed decisions with full context.
        """
        # Get all ready, non-archived items
        query = select(ClothingItem).where(
            and_(
                ClothingItem.user_id == user.id,
                ClothingItem.status == ItemStatus.ready,
                ClothingItem.is_archived == False,
            )
        )

        result = await self.db.execute(query)
        items = list(result.scalars().all())

        if not items:
            return []

        # Only exclude explicitly excluded items (user request or preferences)
        if exclude_items:
            exclude_set = set(exclude_items)
            items = [i for i in items if i.id not in exclude_set]

        if preferences and preferences.excluded_item_ids:
            excluded = set(preferences.excluded_item_ids)
            items = [i for i in items if i.id not in excluded]

        # Exclude recently worn items (user preference)
        if preferences and preferences.avoid_repeat_days:
            items = await self._exclude_recently_worn(
                items, user, preferences.avoid_repeat_days
            )

        return items

    def _filter_by_season(self, items: list[ClothingItem], user: User) -> list[ClothingItem]:
        """Filter items appropriate for current season (in user's timezone)."""
        user_today = get_user_today(user)
        current_season = MONTH_TO_SEASON[user_today.month]

        filtered = []
        for item in items:
            seasons = item.season or []
            # Include if no season specified (all-season) or matches current
            if not seasons or current_season in seasons:
                filtered.append(item)

        return filtered

    def _filter_by_weather(
        self,
        items: list[ClothingItem],
        weather: WeatherData,
        preferences: Optional[UserPreference],
    ) -> list[ClothingItem]:
        """Filter items appropriate for weather conditions."""
        temp = weather.temperature

        # Get thresholds from preferences or use defaults
        cold_threshold = 10
        hot_threshold = 25

        if preferences:
            if preferences.cold_threshold is not None:
                cold_threshold = preferences.cold_threshold
            if preferences.hot_threshold is not None:
                hot_threshold = preferences.hot_threshold

            # Adjust for sensitivity
            if preferences.temperature_sensitivity == "cold":
                cold_threshold += 5  # Feel cold earlier
            elif preferences.temperature_sensitivity == "warm":
                hot_threshold -= 5  # Feel warm earlier

        filtered = []
        for item in items:
            item_type = item.type.lower() if item.type else ""
            material = (item.material or "").lower()
            seasons = item.season or []

            if temp < cold_threshold:
                # Cold weather: need warm items
                if item_type in ["outerwear", "sweater"]:
                    filtered.append(item)
                elif "winter" in seasons:
                    filtered.append(item)
                elif material in ["wool", "fleece", "knit"]:
                    filtered.append(item)
                elif item_type not in ["shorts", "tank-top", "sandals"]:
                    filtered.append(item)
            elif temp > hot_threshold:
                # Hot weather: need light items
                if "summer" in seasons:
                    filtered.append(item)
                elif material in ["cotton", "linen", "silk"]:
                    filtered.append(item)
                elif item_type not in ["outerwear", "sweater", "boots"]:
                    filtered.append(item)
            else:
                # Moderate weather: most items okay
                filtered.append(item)

        return filtered

    def _filter_by_formality(
        self, items: list[ClothingItem], occasion: str
    ) -> list[ClothingItem]:
        """Filter items by occasion formality."""
        allowed_formality = OCCASION_FORMALITY.get(
            occasion.lower(), ["casual", "smart-casual"]
        )

        filtered = []
        for item in items:
            item_formality = (item.formality or "casual").lower()
            if item_formality in allowed_formality:
                filtered.append(item)

        return filtered

    async def _exclude_recently_worn(
        self, items: list[ClothingItem], user: User, avoid_days: int
    ) -> list[ClothingItem]:
        """Exclude items worn within avoid_days (based on user's timezone)."""
        if avoid_days <= 0:
            return items

        # Use user's current date for the cutoff
        user_today = get_user_today(user)
        cutoff_date = user_today - timedelta(days=avoid_days)

        # Get recently worn item IDs
        query = (
            select(ItemHistory.item_id)
            .join(ClothingItem)
            .where(
                and_(
                    ClothingItem.user_id == user.id,
                    ItemHistory.worn_at >= cutoff_date,
                )
            )
            .distinct()
        )

        result = await self.db.execute(query)
        recently_worn = set(result.scalars().all())

        return [i for i in items if i.id not in recently_worn]

    def _format_items_for_prompt(
        self, items: list[ClothingItem]
    ) -> tuple[str, dict[int, UUID]]:
        """
        Format items list for AI prompt using simple numbers.
        Returns (formatted_text, number_to_uuid_mapping).
        Include all relevant details so AI can make informed decisions.
        """
        lines = []
        number_map: dict[int, UUID] = {}

        for i, item in enumerate(items, 1):
            number_map[i] = item.id

            # Build detailed item description
            parts = []

            # Type and subtype
            item_type = item.type or "item"
            if item.subtype:
                parts.append(f"{item.subtype} ({item_type})")
            else:
                parts.append(item_type)

            # Colors
            if item.colors and len(item.colors) > 1:
                parts.append(f"colors: {', '.join(item.colors)}")
            elif item.primary_color:
                parts.append(item.primary_color)

            # Pattern
            if item.pattern and item.pattern != "solid":
                parts.append(item.pattern)

            # Material
            if item.material:
                parts.append(item.material)

            # Formality
            if item.formality:
                parts.append(item.formality)

            # Style tags
            if item.style:
                parts.append(f"style: {', '.join(item.style)}")

            # Name if set
            if item.name:
                parts.insert(0, f'"{item.name}"')

            line = f"[{i}] {' | '.join(parts)}"
            lines.append(line)

        return "\n".join(lines), number_map

    def _format_preferences_for_prompt(
        self, preferences: Optional[UserPreference]
    ) -> str:
        """Format user preferences for AI prompt."""
        if not preferences:
            return ""

        lines = []
        if preferences.color_favorites:
            lines.append(f"- Favorite colors: {', '.join(preferences.color_favorites)}")
        if preferences.color_avoid:
            lines.append(f"- Colors to avoid: {', '.join(preferences.color_avoid)}")
        if preferences.variety_level:
            lines.append(f"- Variety preference: {preferences.variety_level}")

        if lines:
            return "\nUSER PREFERENCES:\n" + "\n".join(lines)
        return ""

    def _parse_ai_response(self, content: str) -> dict:
        """Parse AI response, handling potential formatting issues."""

        def strip_comments(json_str: str) -> str:
            """Remove JavaScript-style comments from JSON string."""
            # Remove single-line comments (// ...)
            json_str = re.sub(r'//[^\n]*', '', json_str)
            # Remove multi-line comments (/* ... */)
            json_str = re.sub(r'/\*[\s\S]*?\*/', '', json_str)
            return json_str

        # Try direct JSON parse
        try:
            return json.loads(content.strip())
        except json.JSONDecodeError:
            pass

        # Try with comments stripped
        try:
            return json.loads(strip_comments(content.strip()))
        except json.JSONDecodeError:
            pass

        # Try extracting JSON from markdown code block
        json_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
        if json_match:
            extracted = json_match.group(1)
            try:
                return json.loads(extracted)
            except json.JSONDecodeError:
                pass
            # Try with comments stripped
            try:
                return json.loads(strip_comments(extracted))
            except json.JSONDecodeError:
                pass

        # Try finding JSON object with balanced braces
        start_idx = content.find("{")
        if start_idx != -1:
            brace_count = 0
            for i, char in enumerate(content[start_idx:], start_idx):
                if char == "{":
                    brace_count += 1
                elif char == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        json_str = content[start_idx : i + 1]
                        try:
                            return json.loads(json_str)
                        except json.JSONDecodeError:
                            pass
                        # Try with comments stripped
                        try:
                            return json.loads(strip_comments(json_str))
                        except json.JSONDecodeError:
                            break

        # Try finding JSON array with balanced brackets (small models sometimes return arrays)
        start_idx = content.find("[")
        if start_idx != -1:
            bracket_count = 0
            for i, char in enumerate(content[start_idx:], start_idx):
                if char == "[":
                    bracket_count += 1
                elif char == "]":
                    bracket_count -= 1
                    if bracket_count == 0:
                        json_str = content[start_idx : i + 1]
                        try:
                            result = json.loads(json_str)
                            # If it's an array of dicts, return the first one
                            if isinstance(result, list) and len(result) > 0:
                                if isinstance(result[0], dict):
                                    return result[0]
                                # If it's an array of numbers (item IDs), wrap it
                                return {"items": result}
                            return result
                        except json.JSONDecodeError:
                            break

        raise ValueError(f"Could not parse AI response as JSON: {content[:200]}")

    async def generate_recommendation(
        self,
        user: User,
        occasion: str,
        weather_override: Optional[WeatherData] = None,
        exclude_items: Optional[list[UUID]] = None,
        include_items: Optional[list[UUID]] = None,
        source: OutfitSource = OutfitSource.on_demand,
    ) -> Outfit:
        """
        Generate an outfit recommendation.

        Args:
            user: The user requesting the recommendation
            occasion: The occasion (casual, work, formal, etc.)
            weather_override: Optional manual weather data
            exclude_items: Item IDs to exclude
            include_items: Item IDs that must be included

        Returns:
            Created Outfit object
        """
        exclude_items = exclude_items or []
        include_items = include_items or []

        # Get weather
        if weather_override:
            weather = weather_override
        else:
            if user.location_lat is None or user.location_lon is None:
                raise ValueError(
                    "User location not set. Please set location in settings."
                )
            try:
                weather = await self.weather_service.get_current_weather(
                    float(user.location_lat), float(user.location_lon)
                )
            except WeatherServiceError as e:
                logger.error(f"Weather service failed: {e}")
                raise ValueError(
                    "Could not fetch weather data. Please try again or provide weather manually."
                ) from e

        # Get preferences
        preferences = user.preferences

        # Create AI service with user's configured endpoints
        ai_endpoints = None
        if preferences and preferences.ai_endpoints:
            ai_endpoints = preferences.ai_endpoints
        ai_service = AIService(endpoints=ai_endpoints)

        # Get candidate items
        candidates = await self.get_candidate_items(
            user=user,
            weather=weather,
            occasion=occasion,
            preferences=preferences,
            exclude_items=exclude_items,
        )

        # Force-include specific items if requested (fetch and add to candidates)
        if include_items:
            include_set = set(include_items)
            existing_ids = {item.id for item in candidates}
            missing_ids = include_set - existing_ids

            if missing_ids:
                # Fetch the missing items from database
                result = await self.db.execute(
                    select(ClothingItem).where(
                        and_(
                            ClothingItem.id.in_(missing_ids),
                            ClothingItem.user_id == user.id,
                            ClothingItem.status == ItemStatus.ready,
                            ClothingItem.is_archived == False,
                        )
                    )
                )
                forced_items = list(result.scalars().all())
                candidates.extend(forced_items)
                logger.info(f"Force-included {len(forced_items)} items in recommendation")

        if len(candidates) < 2:
            raise InsufficientWardrobeError(
                "Not enough items in wardrobe for recommendation. "
                "Please add more items or adjust filters."
            )

        # Build prompt with numbered items
        items_text, number_map = self._format_items_for_prompt(candidates)
        preferences_text = self._format_preferences_for_prompt(preferences)

        prompt = RECOMMENDATION_PROMPT.format(
            occasion=occasion,
            temperature=weather.temperature,
            feels_like=weather.feels_like,
            condition=weather.condition,
            precipitation_chance=weather.precipitation_chance,
            preferences_text=preferences_text,
            items_text=items_text,
        )

        # Generate recommendation using AI
        logger.info(f"Generating recommendation for user {user.id}, occasion: {occasion}, items: {len(candidates)}")

        try:
            result = await ai_service.generate_text(prompt, return_metadata=True)
            logger.info(f"AI recommendation generated (model: {result.model}, endpoint: {result.endpoint})")
            logger.debug(f"AI raw response: {result.content[:500]}")
            outfit_data = self._parse_ai_response(result.content)
            # Handle case where AI returns a list instead of object
            if isinstance(outfit_data, list) and len(outfit_data) > 0:
                outfit_data = outfit_data[0]
            if not isinstance(outfit_data, dict):
                raise ValueError(f"Expected dict, got {type(outfit_data)}")
            # Add model info to outfit data for storage
            outfit_data["_ai_model"] = result.model
            outfit_data["_ai_endpoint"] = result.endpoint
        except Exception as e:
            logger.error(f"AI recommendation failed: {e}")
            raise AIRecommendationError(
                "AI service is not available. Please check your AI endpoint configuration in Settings."
            ) from e

        # Convert item numbers back to UUIDs
        selected_numbers = outfit_data.get("items", [])
        valid_ids = []

        for num in selected_numbers:
            # Handle both int and string numbers
            try:
                num_int = int(num)
                if num_int in number_map:
                    valid_ids.append(number_map[num_int])
                else:
                    logger.warning(f"AI selected invalid item number: {num}")
            except (ValueError, TypeError):
                logger.warning(f"AI returned non-numeric item: {num}")

        if not valid_ids:
            raise AIRecommendationError("AI did not select any valid items")

        # Create outfit record
        # Map structured AI response:
        # - headline → reasoning (for backwards compat with notifications)
        # - highlights → stored in ai_raw_response
        # - styling_tip → style_notes
        reasoning = outfit_data.get("headline") or outfit_data.get("reasoning")
        style_notes = outfit_data.get("styling_tip") or outfit_data.get("style_notes")

        outfit = Outfit(
            user_id=user.id,
            occasion=occasion,
            weather_data=weather.to_dict(),
            scheduled_for=get_user_today(user),
            reasoning=reasoning,
            style_notes=style_notes,
            ai_raw_response=outfit_data,
            source=source,
            status=OutfitStatus.pending,
        )

        self.db.add(outfit)
        await self.db.flush()  # Get the outfit ID

        # Add outfit items
        layers = outfit_data.get("layers", {})
        for position, item_id in enumerate(valid_ids):
            # Determine layer type
            layer_type = None
            for layer_name, layer_id in layers.items():
                if layer_id == str(item_id):
                    layer_type = layer_name
                    break

            outfit_item = OutfitItem(
                outfit_id=outfit.id,
                item_id=item_id,
                position=position,
                layer_type=layer_type,
            )
            self.db.add(outfit_item)

        await self.db.commit()
        await self.db.refresh(outfit)

        # Load relationships for response
        from app.models.outfit import UserFeedback
        result = await self.db.execute(
            select(Outfit)
            .where(Outfit.id == outfit.id)
            .options(
                selectinload(Outfit.items).selectinload(OutfitItem.item),
                selectinload(Outfit.feedback),
            )
        )
        outfit = result.scalar_one()

        logger.info(f"Created outfit {outfit.id} with {len(valid_ids)} items")

        return outfit


class InsufficientWardrobeError(Exception):
    """Not enough items for recommendation."""

    pass


class AIRecommendationError(Exception):
    """AI failed to generate recommendation."""

    pass
