"""Read-only reconciliation of linked accounting invoices. No invoice/payment writes."""

import asyncio
import logging
from typing import Any, cast

from wodana_intelligence.integrations.provider_models import Provider

logger = logging.getLogger(__name__)


async def reconcile_once(core: Any, providers: Any) -> int:
    batch = await core._internal_request("POST", "/internal/commercial/reconciliation/claim")
    count = 0
    for job in batch.get("jobs", []):
        result = {"id": job["id"], "leaseToken": job["leaseToken"]}
        try:
            _, credential = await providers.runtime_internal(
                job["workspaceId"], cast(Provider, job["provider"]), job["connectionId"]
            )
            result["invoice"] = await providers.client.invoice(credential, job["invoiceId"])
        except Exception:
            # Raw provider errors can contain credentials or customer data.
            result["error"] = (
                "Accounting could not refresh this invoice. "
                "Check the connection and company mapping."
            )
        await core._internal_request(
            "POST", "/internal/commercial/reconciliation/result", json=result
        )
        count += 1
    return count


async def poll_accounting(core: Any, providers: Any) -> None:
    while True:
        try:
            await reconcile_once(core, providers)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning(
                "Accounting reconciliation will retry; check service health and connection status"
            )
        await asyncio.sleep(60)


async def poll_project_reminders(core: Any) -> None:
    """In-app due-work notifications; external delivery is deliberately separate."""
    while True:
        try:
            await core._internal_request("POST", "/internal/projects/reminders")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("Project reminders will retry; check business-core health")
        await asyncio.sleep(900)
