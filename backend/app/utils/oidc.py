import logging
import time
from typing import Any

import httpx
from jose import JWTError, jwt

logger = logging.getLogger(__name__)

_jwks_cache: dict[str, dict[str, Any]] = {}
_jwks_cache_times: dict[str, float] = {}
JWKS_CACHE_TTL = 3600


async def _fetch_jwks(issuer_url: str) -> dict:
    now = time.time()
    cached = _jwks_cache.get(issuer_url)
    cache_time = _jwks_cache_times.get(issuer_url, 0)
    if cached and (now - cache_time) < JWKS_CACHE_TTL:
        return cached

    discovery_url = f"{issuer_url.rstrip('/')}/.well-known/openid-configuration"
    async with httpx.AsyncClient(timeout=10) as client:
        disc_resp = await client.get(discovery_url)
        disc_resp.raise_for_status()
        jwks_uri = disc_resp.json()["jwks_uri"]

        jwks_resp = await client.get(jwks_uri)
        jwks_resp.raise_for_status()
        jwks = jwks_resp.json()
        _jwks_cache[issuer_url] = jwks
        _jwks_cache_times[issuer_url] = now
        return jwks


async def validate_oidc_id_token(
    id_token: str,
    issuer_url: str,
    client_id: str,
) -> dict:
    try:
        jwks = await _fetch_jwks(issuer_url)
    except httpx.HTTPError as e:
        logger.error("Failed to fetch OIDC JWKS from %s: %s", issuer_url, e)
        raise ValueError(f"Failed to contact OIDC provider: {e}") from None

    try:
        payload = jwt.decode(
            id_token,
            jwks,
            algorithms=["RS256", "ES256"],
            audience=client_id,
            issuer=issuer_url,
            options={
                "verify_exp": True,
                "verify_at_hash": False,  # NextAuth doesn't provide access_token
            },
        )
    except JWTError as e:
        raise ValueError(f"Invalid OIDC token: {e}") from None

    return payload
