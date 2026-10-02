import base64
import hashlib
import json
import secrets
from datetime import datetime, timezone
from typing import Optional, Protocol, Union

from cryptography.fernet import Fernet, InvalidToken

from wodana_intelligence.integrations.models import OAuthState, StoredGoogleCredential


class InvalidEncryptedSecretError(ValueError):
    """Raised when encrypted provider credentials cannot be authenticated."""


class TokenCipher:
    """Authenticated encryption for provider credentials stored outside Business Core."""

    def __init__(self, encryption_key: str) -> None:
        if len(encryption_key) < 16:
            raise ValueError("Integration encryption key must contain at least 16 characters")
        derived = hashlib.sha256(encryption_key.encode("utf-8")).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(derived))

    def encrypt(self, credential: StoredGoogleCredential) -> str:
        value = credential.model_dump_json(by_alias=True).encode("utf-8")
        return self._fernet.encrypt(value).decode("ascii")

    def decrypt(self, token: str) -> StoredGoogleCredential:
        try:
            value = self._fernet.decrypt(token.encode("ascii"))
            return StoredGoogleCredential.model_validate_json(value)
        except (InvalidToken, ValueError, json.JSONDecodeError) as error:
            raise InvalidEncryptedSecretError("Stored integration credential is invalid") from error

    def seal_value(self, purpose: str, value: str) -> str:
        """Seals one secret for one purpose (for example Wodana's Meta app secret)."""
        envelope = json.dumps({"purpose": purpose, "value": value}, separators=(",", ":"))
        return self._fernet.encrypt(envelope.encode("utf-8")).decode("ascii")

    def open_value(self, purpose: str, token: str) -> str:
        """Opens a value sealed for exactly this purpose; anything else is refused."""
        try:
            data = json.loads(self._fernet.decrypt(token.encode("ascii")))
        except (InvalidToken, ValueError, UnicodeError) as error:
            raise InvalidEncryptedSecretError("Stored platform credential is invalid") from error
        if not isinstance(data, dict) or data.get("purpose") != purpose or not isinstance(
            data.get("value"), str
        ):
            raise InvalidEncryptedSecretError("Stored platform credential is for something else")
        return str(data["value"])


class RedisStateClient(Protocol):
    async def set(self, name: str, value: str, *, ex: int, nx: bool) -> object: ...

    async def getdel(self, name: str) -> Optional[Union[str, bytes]]: ...

    async def get(self, name: str) -> Optional[Union[str, bytes]]: ...


class OAuthStateStore:
    def __init__(self, redis_client: RedisStateClient, ttl_seconds: int = 600) -> None:
        self._redis = redis_client
        self._ttl_seconds = ttl_seconds

    async def issue(self, state: OAuthState) -> str:
        for _ in range(3):
            state_id = secrets.token_urlsafe(32)
            created = await self._redis.set(
                self._key(state_id),
                state.model_dump_json(by_alias=True),
                ex=self._ttl_seconds,
                nx=True,
            )
            if created:
                return state_id
        raise RuntimeError("Unable to allocate a unique OAuth state")

    async def consume(self, state_id: str) -> Optional[OAuthState]:
        if not state_id or len(state_id) > 200:
            return None
        value = await self._redis.getdel(self._key(state_id))
        if value is None:
            return None
        return OAuthState.model_validate_json(value)

    async def peek(self, state_id: str) -> Optional[OAuthState]:
        """Read a state without using it up (to know where to send the person back)."""
        if not state_id or len(state_id) > 200:
            return None
        value = await self._redis.get(self._key(state_id))
        return OAuthState.model_validate_json(value) if value is not None else None

    @staticmethod
    def create_code_verifier() -> str:
        return secrets.token_urlsafe(64)

    @staticmethod
    def code_challenge(verifier: str) -> str:
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    @staticmethod
    def issued_now() -> datetime:
        return datetime.now(timezone.utc)

    @staticmethod
    def _key(state_id: str) -> str:
        return f"wodana:google-oauth-state:{state_id}"
