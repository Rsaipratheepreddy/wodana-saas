from collections.abc import Mapping
from typing import Any, Optional

import httpx


class BusinessCoreError(RuntimeError):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


class BusinessCoreClient:
    def __init__(
        self,
        base_url: str,
        internal_token: str,
        http_client: Optional[httpx.AsyncClient] = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_token = internal_token
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(timeout=10.0)

    async def request_connection(
        self,
        workspace_id: str,
        connection_id: str,
        version: int,
        actor_headers: Mapping[str, str],
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/workspaces/{workspace_id}/integration-connections/{connection_id}/connect",
            headers=dict(actor_headers),
            json={"version": version},
        )

    async def validate_connection(
        self,
        workspace_id: str,
        connection_id: str,
        actor_headers: Mapping[str, str],
    ) -> dict[str, Any]:
        return await self._request(
            "GET",
            f"/workspaces/{workspace_id}/integration-connections/{connection_id}",
            headers=dict(actor_headers),
        )

    async def authorize_connection(
        self,
        workspace_id: str,
        connection_id: str,
        actor_headers: Mapping[str, str],
        write: bool = False,
    ) -> dict[str, Any]:
        return await self._request(
            "POST",
            f"/workspaces/{workspace_id}/integration-connections/{connection_id}/authorize-use",
            headers=dict(actor_headers),
            json={"access": "write" if write else "read"},
        )

    async def runtime_context(self, workspace_id: str, connection_id: str) -> dict[str, Any]:
        return await self._internal_request(
            "GET", f"/internal/integrations/{workspace_id}/{connection_id}/runtime"
        )

    async def provider_runtime(self, workspace_id: str, provider: str) -> dict[str, Any]:
        return await self._internal_request(
            "GET", f"/internal/integrations/workspaces/{workspace_id}/providers/{provider}/runtime"
        )

    async def ingest_provider_message(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._internal_request(
            "POST", "/internal/crm/provider-messages", json=payload
        )

    async def record_provider_receipt(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._internal_request(
            "POST", "/internal/crm/provider-receipts", json=payload
        )

    async def complete_google(self, connection_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._internal_request(
            "POST", f"/internal/integrations/{connection_id}/google/complete", json=payload
        )

    async def fail_connection(self, connection_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._internal_request(
            "POST", f"/internal/integrations/{connection_id}/failure", json=payload
        )

    async def discover_resources(
        self, connection_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._internal_request(
            "POST", f"/internal/integrations/{connection_id}/resources/discover", json=payload
        )

    async def mark_synced(self, connection_id: str, workspace_id: str) -> None:
        await self._internal_request(
            "POST",
            f"/internal/integrations/{connection_id}/synced",
            json={"workspaceId": workspace_id},
        )

    async def record_health(
        self,
        connection_id: str,
        workspace_id: str,
        operation: str,
        succeeded: bool,
        error_code: str | None = None,
    ) -> None:
        await self._internal_request(
            "POST",
            f"/internal/integrations/{connection_id}/health",
            json={
                "workspaceId": workspace_id,
                "operation": operation,
                "succeeded": succeeded,
                **({"errorCode": error_code} if error_code else {}),
            },
        )

    async def record_activity(
        self,
        connection_id: str,
        workspace_id: str,
        action: str,
        external_id: str,
        metadata: dict[str, Any],
    ) -> None:
        await self._internal_request(
            "POST",
            f"/internal/integrations/{connection_id}/activity",
            json={
                "workspaceId": workspace_id,
                "action": action,
                "externalId": external_id,
                "metadata": metadata,
            },
        )

    async def revoke_connection(
        self,
        workspace_id: str,
        connection_id: str,
        version: int,
        actor_headers: Mapping[str, str],
    ) -> dict[str, Any]:
        return await self._request(
            "DELETE",
            f"/workspaces/{workspace_id}/integration-connections/{connection_id}",
            headers=dict(actor_headers),
            params={"version": version},
        )

    async def matching_automations(
        self, workspace_id: str, event_type: str
    ) -> list[dict[str, Any]]:
        payload = await self._internal_request(
            "GET",
            f"/internal/crm/automations/workspaces/{workspace_id}/matches",
            params={"eventType": event_type},
        )
        items = payload.get("items", [])
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    async def start_automation_run(
        self, definition_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._internal_request(
            "POST", f"/internal/crm/automations/{definition_id}/runs", json=payload
        )

    async def advance_automation_run(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._internal_request(
            "POST", f"/internal/crm/automations/runs/{run_id}/advance", json=payload
        )

    async def execute_automation_step(self, run_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._internal_request(
            "POST", f"/internal/crm/automations/runs/{run_id}/steps/execute", json=payload
        )

    async def automation_run_context(self, workspace_id: str, run_id: str) -> dict[str, Any]:
        return await self._internal_request(
            "GET", f"/internal/crm/automations/workspaces/{workspace_id}/runs/{run_id}"
        )

    async def due_crm_workspaces(self) -> list[str]:
        payload = await self._internal_request("GET", "/internal/crm/automations/workspaces/due")
        values = payload.get("workspaceIds", [])
        return [str(value) for value in values] if isinstance(values, list) else []

    async def claim_automation_waits(self, workspace_id: str) -> list[dict[str, Any]]:
        payload = await self._internal_request(
            "POST",
            "/internal/crm/automations/waits/claim",
            json={"workspaceId": workspace_id, "limit": 50},
        )
        items = payload.get("items", [])
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    async def complete_automation_wait(
        self, wait_id: str, workspace_id: str, claim_token: str
    ) -> dict[str, Any]:
        return await self._internal_request(
            "POST",
            f"/internal/crm/automations/waits/{wait_id}/complete",
            json={"workspaceId": workspace_id, "claimToken": claim_token},
        )

    async def process_due_slas(self, workspace_id: str) -> dict[str, Any]:
        return await self._internal_request(
            "POST",
            f"/internal/crm/slas/workspaces/{workspace_id}/process",
            json={"limit": 100},
        )

    async def process_due_takeovers(self, workspace_id: str) -> dict[str, Any]:
        return await self._internal_request(
            "POST",
            f"/internal/crm/slas/workspaces/{workspace_id}/process-takeovers",
            json={"limit": 100},
        )

    async def process_due_sequences(self, workspace_id: str) -> dict[str, Any]:
        return await self._internal_request(
            "POST",
            f"/internal/crm/workspaces/{workspace_id}/sequences/process",
            json={"limit": 50},
        )

    async def wake_snoozed_conversations(self, workspace_id: str) -> dict[str, Any]:
        """Snoozed chats whose time has come are open again and their owner is told."""
        return await self._internal_request(
            "POST",
            f"/internal/crm/workspaces/{workspace_id}/conversations/wake",
            json={"limit": 50},
        )

    async def whatsapp_template_work(self, workspace_id: str) -> dict[str, Any]:
        """Starter templates to submit to Meta, and whether the daily status sync is due."""
        return await self._internal_request(
            "POST", f"/internal/crm/workspaces/{workspace_id}/whatsapp-templates/due", json={}
        )

    async def whatsapp_templates_synced(
        self, workspace_id: str, templates: list[dict[str, Any]], full: bool
    ) -> dict[str, Any]:
        return await self._internal_request(
            "POST",
            f"/internal/crm/workspaces/{workspace_id}/whatsapp-templates/sync",
            json={"full": full, "templates": templates},
        )

    async def whatsapp_template_submitted(
        self, workspace_id: str, template_id: str, result: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._internal_request(
            "POST",
            f"/internal/crm/workspaces/{workspace_id}/whatsapp-templates/{template_id}/submitted",
            json=result,
        )

    async def enqueue_notification(self, payload: dict[str, Any]) -> dict[str, Any]:
        return await self._internal_request(
            "POST", "/internal/crm/notifications/enqueue", json=payload
        )

    async def claim_notification_jobs(self, workspace_id: str) -> list[dict[str, Any]]:
        payload = await self._internal_request(
            "POST",
            "/internal/crm/notifications/claim",
            json={"workspaceId": workspace_id, "limit": 50},
        )
        items = payload.get("items", [])
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    async def dispatch_staff_emails(self, workspace_id: str) -> dict[str, Any]:
        """Staff emails are sent by Business Core in the tenant's brand."""
        return await self._internal_request(
            "POST",
            "/internal/crm/notifications/staff-email/dispatch",
            json={"workspaceId": workspace_id, "limit": 50},
        )

    async def record_notification_result(
        self, notification_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._internal_request(
            "POST", f"/internal/crm/notifications/{notification_id}/result", json=payload
        )

    async def claim_push_receipts(self, workspace_id: str) -> list[dict[str, Any]]:
        payload = await self._internal_request(
            "POST",
            "/internal/crm/notifications/push-receipts/claim",
            json={"workspaceId": workspace_id, "limit": 100},
        )
        items = payload.get("items", [])
        return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []

    async def record_push_receipt(
        self, notification_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        return await self._internal_request(
            "POST",
            f"/internal/crm/notifications/{notification_id}/push-receipt",
            json=payload,
        )

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _internal_request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: Optional[Mapping[str, Any]] = None,
    ) -> dict[str, Any]:
        headers: dict[str, str] = {}
        headers["x-wodana-internal-token"] = self._internal_token
        return await self._request(method, path, headers=headers, json=json, params=params)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        headers: Optional[Mapping[str, str]] = None,
        json: Any = None,
        params: Optional[Mapping[str, Any]] = None,
    ) -> dict[str, Any]:
        try:
            response = await self._client.request(
                method,
                f"{self._base_url}{path}",
                headers=headers,
                json=json,
                params=params,
            )
        except httpx.HTTPError as error:
            raise BusinessCoreError("Business Core is unavailable") from error
        if response.is_error:
            try:
                payload = response.json()
                message = payload.get("message") or payload.get("detail")
            except ValueError:
                message = None
            raise BusinessCoreError(
                str(message or "Business Core rejected the integration request"),
                response.status_code,
            )
        payload = response.json()
        if not isinstance(payload, dict):
            raise BusinessCoreError("Business Core returned an invalid response")
        return payload
