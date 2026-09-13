from typing import Optional, Protocol, Union

from wodana_intelligence.integrations.models import StoredGoogleCredential
from wodana_intelligence.integrations.security import TokenCipher


class RedisVaultClient(Protocol):
    async def set(self, name: str, value: str) -> object: ...

    async def get(self, name: str) -> Optional[Union[str, bytes]]: ...

    async def delete(self, *names: str) -> int: ...


class CredentialNotFoundError(LookupError):
    """Raised when a connection has no usable provider credential."""


class RedisCredentialVault:
    def __init__(self, redis_client: RedisVaultClient, cipher: TokenCipher) -> None:
        self._redis = redis_client
        self._cipher = cipher

    async def put(self, reference: str, credential: StoredGoogleCredential) -> None:
        await self._redis.set(self._key(reference), self._cipher.encrypt(credential))

    async def get(self, reference: str) -> StoredGoogleCredential:
        value = await self._redis.get(self._key(reference))
        if value is None:
            raise CredentialNotFoundError("Google connection needs to be reconnected")
        encoded = value.decode("ascii") if isinstance(value, bytes) else value
        return self._cipher.decrypt(encoded)

    async def delete(self, reference: str) -> None:
        await self._redis.delete(self._key(reference))

    @staticmethod
    def reference(workspace_id: str, connection_id: str) -> str:
        return f"redis:google:{workspace_id}:{connection_id}"

    @staticmethod
    def _key(reference: str) -> str:
        if not reference.startswith("redis:google:"):
            raise ValueError("Unsupported integration secret reference")
        return f"wodana:integration-secret:{reference}"
