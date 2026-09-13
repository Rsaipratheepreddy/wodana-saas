from typing import Any, Optional, Union


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def set(
        self,
        name: str,
        value: str,
        *,
        ex: Optional[int] = None,
        nx: bool = False,
    ) -> bool:
        del ex
        if nx and name in self.values:
            return False
        self.values[name] = value
        return True

    async def get(self, name: str) -> Optional[Union[str, bytes]]:
        return self.values.get(name)

    async def getdel(self, name: str) -> Optional[Union[str, bytes]]:
        return self.values.pop(name, None)

    async def delete(self, *names: str) -> int:
        removed = 0
        for name in names:
            if name in self.values:
                removed += 1
                del self.values[name]
        return removed


class FakeBusinessCore:
    def __init__(self) -> None:
        self.completed: Optional[dict[str, Any]] = None
        self.failure: Optional[dict[str, Any]] = None
        self.synced: list[str] = []
        self.revoked = False
        self.activities: list[dict[str, Any]] = []

    async def request_connection(
        self,
        workspace_id: str,
        connection_id: str,
        version: int,
        actor_headers: dict[str, str],
    ) -> dict[str, Any]:
        assert actor_headers
        return {
            "id": connection_id,
            "workspaceId": workspace_id,
            "provider": "google_workspace",
            "externalDomain": "palmlivingae.com",
            "status": "pending",
            "version": version + 1,
        }

    async def validate_connection(
        self,
        workspace_id: str,
        connection_id: str,
        actor_headers: dict[str, str],
    ) -> dict[str, Any]:
        assert workspace_id and connection_id and actor_headers
        return {"provider": "google_workspace", "status": "connected"}

    async def authorize_connection(
        self,
        workspace_id: str,
        connection_id: str,
        actor_headers: dict[str, str],
        write: bool = False,
    ) -> dict[str, Any]:
        assert write and actor_headers and workspace_id and connection_id
        return {"provider": "google_workspace", "status": "connected"}

    async def runtime_context(self, workspace_id: str, connection_id: str) -> dict[str, Any]:
        assert self.completed is not None
        resources = []
        for index, resource in enumerate(self.completed["resources"]):
            resources.append(
                {
                    "id": f"00000000-0000-4000-8000-{index + 1:012d}",
                    "externalId": resource["externalId"],
                    "displayName": resource["displayName"],
                    "enabled": resource["enabled"],
                    "direction": resource["direction"],
                    "configuration": resource["configuration"],
                }
            )
        return {
            "id": connection_id,
            "workspaceId": workspace_id,
            "provider": "google_workspace",
            "externalAccountId": self.completed["externalAccountId"],
            "externalDomain": self.completed["externalDomain"],
            "status": "connected",
            "grantedScopes": self.completed["grantedScopes"],
            "secretReference": self.completed["secretReference"],
            "tokenExpiresAt": self.completed["tokenExpiresAt"],
            "version": self.completed["expectedVersion"] + 1,
            "resources": resources,
        }

    async def complete_google(self, connection_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.completed = payload
        return {"id": connection_id, "status": "connected"}

    async def fail_connection(self, connection_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.failure = {"connectionId": connection_id, **payload}
        return {"id": connection_id, "status": "degraded"}

    async def discover_resources(
        self, connection_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        assert self.completed is not None
        self.completed["resources"] = payload["resources"]
        return {"connectionId": connection_id, "resources": payload["resources"]}

    async def mark_synced(self, connection_id: str, workspace_id: str) -> None:
        assert workspace_id
        self.synced.append(connection_id)

    async def record_health(
        self,
        connection_id: str,
        workspace_id: str,
        operation: str,
        succeeded: bool,
        error_code: str | None = None,
    ) -> None:
        self.synced.append(connection_id)
        self.activities.append({
            "connectionId": connection_id,
            "workspaceId": workspace_id,
            "action": (
                "integration.provider_read_succeeded"
                if succeeded
                else "integration.provider_read_failed"
            ),
            "operation": operation,
            "errorCode": error_code,
        })

    async def record_activity(
        self,
        connection_id: str,
        workspace_id: str,
        action: str,
        external_id: str,
        metadata: dict[str, Any],
    ) -> None:
        self.activities.append(
            {
                "connectionId": connection_id,
                "workspaceId": workspace_id,
                "action": action,
                "externalId": external_id,
                "metadata": metadata,
            }
        )

    async def revoke_connection(
        self,
        workspace_id: str,
        connection_id: str,
        version: int,
        actor_headers: dict[str, str],
    ) -> dict[str, Any]:
        assert workspace_id and version and actor_headers
        self.revoked = True
        return {"id": connection_id, "status": "revoked", "version": version + 1}
