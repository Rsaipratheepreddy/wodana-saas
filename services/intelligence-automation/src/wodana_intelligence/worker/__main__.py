import asyncio
import logging
import signal

import redis.asyncio as redis

from wodana_intelligence.config import get_settings
from wodana_intelligence.container import get_google_integration_service, get_provider_service
from wodana_intelligence.integrations.business_core import BusinessCoreClient
from wodana_intelligence.worker.accounting import (
    poll_accounting,
    poll_control_plane,
    poll_project_reminders,
)
from wodana_intelligence.worker.accounting_sync import poll_postings
from wodana_intelligence.worker.adapters import notification_adapter
from wodana_intelligence.worker.runtime import CrmWorker

logger = logging.getLogger("wodana.worker")


async def run() -> None:
    settings = get_settings()
    logging.basicConfig(
        level=getattr(logging, settings.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    # httpx logs every request URL at INFO; accounting lookups carry contact names and document
    # numbers in the query string, so those URLs must not reach the logs.
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signal_name, stop.set)

    client = redis.from_url(  # type: ignore[no-untyped-call]
        settings.redis_url,
        decode_responses=True,
    )
    business_core = BusinessCoreClient(
        settings.business_core_url, settings.business_core_internal_token
    )
    google = await get_google_integration_service()
    providers = await get_provider_service()
    adapter = notification_adapter(
        settings.notification_adapter_mode, settings.environment, business_core, google, providers
    )
    worker = CrmWorker(
        client,
        business_core,
        adapter,
        settings.worker_consumer_group,
        settings.worker_consumer_name,
    )
    try:
        await client.ping()
        await worker.ensure_group()
        await worker.recover_pending()
        logger.info("Worker ready; CRM event, automation, timer, and notification handlers active")
        timer_task = asyncio.create_task(worker.poll_due_work())
        accounting_task = asyncio.create_task(poll_accounting(business_core, providers))
        postings_task = asyncio.create_task(poll_postings(business_core, providers))
        project_reminders_task = asyncio.create_task(poll_project_reminders(business_core))
        control_plane_task = asyncio.create_task(poll_control_plane(business_core))
        try:
            while not stop.is_set():
                await worker.consume_once()
        finally:
            timer_task.cancel()
            accounting_task.cancel()
            postings_task.cancel()
            project_reminders_task.cancel()
            control_plane_task.cancel()
            await asyncio.gather(
                timer_task,
                accounting_task,
                postings_task,
                project_reminders_task,
                control_plane_task,
                return_exceptions=True,
            )
    finally:
        await business_core.close()
        await client.aclose()
        logger.info("Worker stopped")


if __name__ == "__main__":
    asyncio.run(run())
