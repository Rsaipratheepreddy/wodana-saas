from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fakes import FakeRedis

from wodana_intelligence.integrations.models import (
    GoogleAccessMode,
    OAuthState,
    StoredGoogleCredential,
)
from wodana_intelligence.integrations.security import (
    InvalidEncryptedSecretError,
    OAuthStateStore,
    TokenCipher,
)
from wodana_intelligence.integrations.vault import (
    CredentialNotFoundError,
    RedisCredentialVault,
)


def credential() -> StoredGoogleCredential:
    return StoredGoogleCredential(
        access_token="access-secret",
        refresh_token="refresh-secret",
        scopes=["calendar"],
        expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        account_email="operations@palmlivingae.com",
    )


@pytest.mark.asyncio
async def test_vault_encrypts_round_trips_and_deletes_credentials() -> None:
    redis = FakeRedis()
    vault = RedisCredentialVault(
        redis, TokenCipher("a-strong-local-test-key-that-is-not-production")
    )
    reference = RedisCredentialVault.reference(str(uuid4()), str(uuid4()))

    await vault.put(reference, credential())

    stored_value = next(iter(redis.values.values()))
    assert "access-secret" not in stored_value
    assert (await vault.get(reference)).refresh_token == "refresh-secret"

    await vault.delete(reference)
    with pytest.raises(CredentialNotFoundError):
        await vault.get(reference)


def test_cipher_rejects_tampered_secret() -> None:
    cipher = TokenCipher("a-strong-local-test-key-that-is-not-production")
    token = cipher.encrypt(credential())

    with pytest.raises(InvalidEncryptedSecretError):
        cipher.decrypt(token[:-2] + "xx")


@pytest.mark.asyncio
async def test_oauth_state_is_random_and_can_only_be_consumed_once() -> None:
    redis = FakeRedis()
    states = OAuthStateStore(redis, ttl_seconds=600)
    value = OAuthState(
        workspace_id=uuid4(),
        connection_id=uuid4(),
        expected_version=2,
        expected_domain="palmlivingae.com",
        code_verifier=states.create_code_verifier(),
        access_mode=GoogleAccessMode.MANAGE,
        requested_scopes=["openid"],
        issued_at=states.issued_now(),
    )

    state_id = await states.issue(value)

    assert len(state_id) >= 32
    assert (await states.consume(state_id)) == value
    assert await states.consume(state_id) is None
