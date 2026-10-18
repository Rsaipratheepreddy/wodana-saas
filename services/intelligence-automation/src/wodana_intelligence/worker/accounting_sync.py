"""Posts Business Core's accounting documents to the linked QuickBooks or Zoho Books company.

Business Core owns each posting and leases it for five minutes; this loop only makes the provider
calls and reports one result per posting. Provider responses, tokens and customer data never reach
the logs or the reported messages.
"""

import asyncio
import logging
import time
from typing import Any, Optional, cast
from uuid import UUID

from pydantic import ValidationError

from wodana_intelligence.integrations.accounting_client import (
    RECONNECT,
    AccountingClient,
    PostingFailure,
    PostingOutcome,
)
from wodana_intelligence.integrations.accounting_models import Posting
from wodana_intelligence.integrations.business_core import BusinessCoreError
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.provider_models import Provider, ProviderCredential

logger = logging.getLogger(__name__)

CLAIM_PATH = "/internal/accounting/postings/claim"
RESULT_PATH = "/internal/accounting/postings/result"
# Leases last 300 s. Postings not started within this budget are left for their lease to lapse,
# so no posting is ever worked on by two workers at once.
BATCH_BUDGET_SECONDS = 240.0
POLL_SECONDS = 30
# Credential failures worth retrying; any other one needs the connection reconnected.
_TRANSIENT_CREDENTIAL_CODES = {
    "provider_unavailable",
    "provider_rate_limited",
    "provider_invalid_response",
    "refresh_in_progress",
}


async def sync_postings_once(core: Any, providers: Any) -> int:
    """Claim one batch, post each document and report its result. Returns results reported."""
    batch = await core._internal_request("POST", CLAIM_PATH)
    postings = batch.get("postings") if isinstance(batch, dict) else None
    if not isinstance(postings, list):
        logger.warning("Accounting posting claim returned no posting list")
        return 0
    accounting = AccountingClient(providers.client)
    deadline = time.monotonic() + BATCH_BUDGET_SECONDS
    reported = 0
    for index, item in enumerate(postings):
        if time.monotonic() > deadline:
            logger.warning(
                "Left %d accounting postings for their lease to lapse", len(postings) - index
            )
            break
        result = await _process(item, providers, accounting)
        if result is None:
            continue
        try:
            await core._internal_request("POST", RESULT_PATH, json=result)
        except Exception:
            # The lease lapses and the posting is claimed again; the repeat is deduplicated.
            logger.warning("Accounting posting %s result will be retried", result["id"])
            continue
        reported += 1
    return reported


async def poll_postings(core: Any, providers: Any) -> None:
    while True:
        try:
            await sync_postings_once(core, providers)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "Accounting posting will retry; check business-core health and connection status"
            )
        await asyncio.sleep(POLL_SECONDS)


async def _process(
    item: Any, providers: Any, accounting: AccountingClient
) -> Optional[dict[str, Any]]:
    identity = _identity(item)
    if identity is None:
        logger.warning("Skipped an accounting posting without a valid id and lease")
        return None
    try:
        posting = Posting.model_validate(item)
    except ValidationError as error:
        return _failed(identity, PostingFailure("invalid_posting", _invalid_fields(error), False))
    try:
        credential = await _credential(providers, posting)
        outcome = await accounting.post(credential, posting)
    except PostingFailure as failure:
        logger.warning(
            "Accounting posting %s (%s, %s) failed: %s",
            posting.id,
            posting.provider,
            posting.kind,
            failure.code,
        )
        return _failed(identity, failure)
    except Exception:
        # Never log the exception: provider and parsing errors can carry customer data.
        # Retrying is safe: QuickBooks deduplicates by requestid, Zoho Books searches first.
        logger.warning(
            "Accounting posting %s (%s, %s) failed unexpectedly; it will be retried",
            posting.id,
            posting.provider,
            posting.kind,
        )
        return _failed(
            identity,
            PostingFailure(
                "sync_failed", "The posting could not be completed; it will be retried", True
            ),
        )
    return _succeeded(identity, outcome)


async def _credential(providers: Any, posting: Posting) -> ProviderCredential:
    try:
        _, credential = await providers.runtime_internal(
            str(posting.workspace_id), cast(Provider, posting.provider), str(posting.connection_id)
        )
    except IntegrationFlowError as error:
        # Includes a refused token refresh (revoked grant, access denied).
        if error.code in _TRANSIENT_CREDENTIAL_CODES:
            raise PostingFailure(
                "provider_unavailable",
                "The accounting connection could not be refreshed; this will be retried",
                True,
            ) from None
        raise PostingFailure("connection_expired", RECONNECT, False) from None
    except BusinessCoreError as error:
        if error.status_code >= 500 or error.status_code == 429:
            raise PostingFailure(
                "provider_unavailable",
                "The accounting connection could not be loaded; this will be retried",
                True,
            ) from None
        raise PostingFailure("connection_expired", RECONNECT, False) from None
    return cast(ProviderCredential, credential)


def _identity(item: Any) -> Optional[dict[str, str]]:
    if not isinstance(item, dict):
        return None
    try:
        return {"id": str(UUID(str(item["id"]))), "leaseToken": str(UUID(str(item["leaseToken"])))}
    except (KeyError, ValueError):
        return None


def _invalid_fields(error: ValidationError) -> str:
    # Field paths only; input values (names, amounts, emails) are never echoed.
    fields: list[str] = []
    for detail in error.errors(include_input=False, include_url=False)[:5]:
        field = ".".join(str(part) for part in detail["loc"]) or "posting"
        if detail["type"] == "value_error":
            # Only this module's own validators raise value errors, with fixed sentences.
            field += f" ({str(detail['msg']).removeprefix('Value error, ')})"
        if field not in fields:
            fields.append(field)
    return ("Invalid posting: " + ", ".join(fields))[:500]


def _decimal_text(value: Any) -> Optional[str]:
    return None if value is None else format(value, "f")


def _succeeded(identity: dict[str, str], outcome: PostingOutcome) -> dict[str, Any]:
    result: dict[str, Any] = {
        **identity,
        "providerId": outcome.provider_id,
        "providerNumber": outcome.provider_number,
        "providerTotal": _decimal_text(outcome.provider_total),
    }
    if outcome.contact_provider_id:
        result["contactProviderId"] = outcome.contact_provider_id
    if outcome.warning:
        code, message = outcome.warning
        result["warning"] = {"code": code, "message": message}
    return result


def _failed(identity: dict[str, str], failure: PostingFailure) -> dict[str, Any]:
    result: dict[str, Any] = {**identity, "providerNumber": None, "providerTotal": None}
    if failure.contact_provider_id:
        result["contactProviderId"] = failure.contact_provider_id
    result["error"] = {
        "code": failure.code,
        "message": failure.message,
        "retryable": failure.retryable,
    }
    return result
