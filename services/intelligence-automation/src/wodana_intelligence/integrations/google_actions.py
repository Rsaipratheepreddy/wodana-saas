"""Explicit Gmail and Drive actions using the workspace's encrypted Google grant."""

import base64
import hashlib
from collections.abc import Mapping
from email.message import EmailMessage
from typing import Any
from uuid import UUID

from wodana_intelligence.integrations.google_service import (
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.provider_client import ProviderClient
from wodana_intelligence.integrations.provider_models import (
    DriveDocumentRequest,
    EmailRequest,
    OperationRequest,
)
from wodana_intelligence.integrations.provider_service import ProviderService, guard_delivery


async def execute_google(
    service: GoogleIntegrationService,
    providers: ProviderService,
    http: ProviderClient,
    workspace: UUID,
    connection: UUID,
    request: OperationRequest,
    headers: Mapping[str, str],
    *,
    authorize: bool = True,
) -> dict[str, Any]:
    if authorize:
        await service._business_core.authorize_connection(
            str(workspace),
            str(connection),
            dict(headers),
            write=True,
        )
        public = await service._business_core.validate_connection(
            str(workspace), str(connection), headers
        )
    else:
        public = await service._business_core.runtime_context(str(workspace), str(connection))
    runtime = await service._active_runtime(workspace, connection, public)
    credential = await service._access_credential(runtime)
    scope = {"email.send": "gmail.send", "document.create": "drive.file"}.get(request.action)
    if not scope:
        raise IntegrationFlowError("invalid_operation", "This action is not supported by Google")
    if f"https://www.googleapis.com/auth/{scope}" not in credential.scopes:
        raise IntegrationFlowError(
            "scope_missing", "Reconnect Google and enable this capability", 409
        )
    validated = (
        EmailRequest.model_validate(request.payload)
        if request.action == "email.send"
        else DriveDocumentRequest.model_validate(request.payload)
    )
    if isinstance(validated, EmailRequest):
        guard_delivery(providers.settings, email=validated.to)
    key = f"wodana:google-operation:{workspace}:{connection}:{request.idempotency_key}"
    digest = hashlib.sha256(
        request.model_dump_json(exclude={"idempotency_key"}).encode()
    ).hexdigest()
    saved = await providers.redis.get(key)
    if saved:
        prior = providers.open(saved)
        if prior["hash"] != digest:
            raise IntegrationFlowError(
                "idempotency_conflict", "This key was already used for different content", 409
            )
        if "result" in prior:
            cached = dict(prior["result"])
            await service._business_core.record_activity(
                str(connection),
                str(workspace),
                request.action,
                cached["id"],
                {"status": cached["status"], "operationId": str(request.idempotency_key)},
            )
            return cached
        raise IntegrationFlowError(
            "operation_unconfirmed",
            "Check the connected Google account before sending this request again",
            409,
        )
    if not await providers.redis.set(
        key, providers.seal({"hash": digest, "state": "processing"}), nx=True
    ):
        raise IntegrationFlowError("operation_in_progress", "Request is already processing", 409)
    auth = {"Authorization": f"Bearer {credential.access_token}"}
    if isinstance(validated, EmailRequest):
        message = EmailMessage()
        message["From"] = credential.account_email
        message["To"] = validated.to
        message["Subject"] = validated.subject
        message["Message-ID"] = f"<{request.idempotency_key}@wodana>"
        message.set_content(validated.body)
        response = await http.request(
            "POST",
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            headers=auth,
            json={"raw": base64.urlsafe_b64encode(message.as_bytes()).decode()},
        )
        result = {"id": response["id"], "status": "accepted"}
    else:
        metadata: dict[str, Any] = {"name": validated.name, "mimeType": "text/plain"}
        if validated.folder_id:
            metadata["parents"] = [validated.folder_id]
        # Multipart/related is required by Drive; multipart/form-data is not supported.
        import json

        boundary = "wodana_" + request.idempotency_key.hex
        body = (
            f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n"
            + json.dumps(metadata)
            + f"\r\n--{boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
            + validated.content
            + f"\r\n--{boundary}--\r\n"
        )
        response = await http.request(
            "POST",
            "https://www.googleapis.com/upload/drive/v3/files",
            params={"uploadType": "multipart", "fields": "id,name,webViewLink"},
            headers={**auth, "Content-Type": f"multipart/related; boundary={boundary}"},
            content=body.encode(),
        )
        result = {"id": response["id"], "url": response.get("webViewLink"), "status": "created"}
    await providers.redis.set(key, providers.seal({"hash": digest, "result": result}))
    await service._business_core.record_activity(
        str(connection),
        str(workspace),
        request.action,
        result["id"],
        {"status": result["status"], "operationId": str(request.idempotency_key)},
    )
    return result
