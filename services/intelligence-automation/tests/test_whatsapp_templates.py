from typing import Any

import pytest

from wodana_intelligence.worker.runtime import CrmWorker

WORKSPACE_ID = "11111111-1111-4111-8111-111111111111"


class FakeAdapter:
    def __init__(self, refuse: bool = False) -> None:
        self.submitted: list[dict[str, Any]] = []
        self.refuse = refuse

    async def deliver(self, job: Any) -> Any:  # pragma: no cover - not used here
        raise AssertionError("not used")

    async def verify_push(self, receipt: Any) -> Any:  # pragma: no cover - not used here
        raise AssertionError("not used")

    async def submit_whatsapp_template(self, _workspace: str, template: dict[str, Any]) -> dict[str, Any]:
        if self.refuse:
            raise RuntimeError("Template name already exists")
        self.submitted.append(template)
        return {"id": "meta-1", "status": "PENDING"}

    async def whatsapp_templates(self, _workspace: str) -> list[dict[str, Any]]:
        return [{"id": "meta-1", "name": "wd_quote_ready", "language": "en", "status": "APPROVED", "category": "UTILITY", "quality": "GREEN", "reason": None, "body": "Hello {{1}}"}]


class FakeCore:
    def __init__(self, sync: bool) -> None:
        self.sync = sync
        self.results: list[tuple[str, dict[str, Any]]] = []
        self.synced: list[tuple[list[dict[str, Any]], bool]] = []

    async def whatsapp_template_work(self, _workspace: str) -> dict[str, Any]:
        return {"submissions": [{"id": "t1", "name": "wd_quote_ready", "language": "en", "category": "UTILITY", "body": "Hello {{1}}, ready.", "examples": ["Noura"]}], "sync": self.sync}

    async def whatsapp_template_submitted(self, _workspace: str, template_id: str, result: dict[str, Any]) -> dict[str, Any]:
        self.results.append((template_id, result))
        return {}

    async def whatsapp_templates_synced(self, _workspace: str, templates: list[dict[str, Any]], full: bool, health: dict[str, Any] | None = None) -> dict[str, Any]:
        self.synced.append((templates, full))
        return {}


@pytest.mark.asyncio
async def test_submits_starter_templates_and_syncs_statuses_daily() -> None:
    core, adapter = FakeCore(sync=True), FakeAdapter()
    worker = CrmWorker(object(), core, adapter, "group", "consumer")  # type: ignore[arg-type]
    await worker.whatsapp_templates(WORKSPACE_ID)
    assert adapter.submitted[0]["examples"] == ["Noura"]
    assert core.results == [("t1", {"providerTemplateId": "meta-1", "status": "PENDING"})]
    assert core.synced[0][1] is True
    assert core.synced[0][0][0]["status"] == "APPROVED"


@pytest.mark.asyncio
async def test_a_refused_submission_is_reported_with_its_reason() -> None:
    core, adapter = FakeCore(sync=False), FakeAdapter(refuse=True)
    worker = CrmWorker(object(), core, adapter, "group", "consumer")  # type: ignore[arg-type]
    await worker.whatsapp_templates(WORKSPACE_ID)
    assert core.results == [("t1", {"error": "Template name already exists"})]
    assert core.synced == []
