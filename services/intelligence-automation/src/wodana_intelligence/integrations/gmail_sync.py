"""Bring recent Gmail inbox messages into tenant-scoped CRM conversations."""

import base64
from collections.abc import Mapping
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from typing import Any
from uuid import UUID

from wodana_intelligence.integrations.google_service import (
    GMAIL_READ_SCOPE,
    GoogleIntegrationService,
    IntegrationFlowError,
)
from wodana_intelligence.integrations.provider_client import ProviderClient


async def sync_gmail(
    service: GoogleIntegrationService,
    http: ProviderClient,
    workspace: UUID,
    connection: UUID,
    headers: Mapping[str, str],
) -> dict[str, Any]:
    public = await service._business_core.validate_connection(
        str(workspace), str(connection), headers
    )
    runtime = await service._active_runtime(workspace, connection, public)
    if GMAIL_READ_SCOPE not in runtime.granted_scopes:
        raise IntegrationFlowError(
            "gmail_read_scope_missing",
            "Reconnect Google once to enable CRM inbox sync",
            409,
        )
    credential = await service._access_credential(runtime)
    auth = {"Authorization": f"Bearer {credential.access_token}"}
    listing = await http.request(
        "GET",
        "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        headers=auth,
        params={"q": "in:inbox newer_than:30d", "maxResults": 50},
    )
    imported = 0
    for item in listing.get("messages", []):
        message_id = str(item.get("id", ""))
        if not message_id:
            continue
        data = await http.request(
            "GET",
            f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",
            headers=auth,
            params={"format": "raw"},
        )
        raw = str(data.get("raw", ""))
        if not raw:
            continue
        decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        message = BytesParser(policy=policy.default).parsebytes(decoded)
        _name, sender = parseaddr(str(message.get("From", "")))
        if not sender or sender.lower() == credential.account_email.lower():
            continue
        body = message.get_body(preferencelist=("plain", "html"))
        content = body.get_content() if body else ""
        await service._business_core.ingest_provider_message(
            {
                "workspaceId": str(workspace),
                "channel": "email",
                "providerThreadId": str(data.get("threadId") or message_id),
                "providerMessageId": message_id,
                "contact": sender,
                "displayName": _name or None,
                "subject": str(message.get("Subject") or "Email conversation")[:500],
                "bodyText": str(content)[:100_000] or "Email received",
                "metadata": {
                    "provider": "google_workspace",
                    "connectionId": str(connection),
                    "gmailThreadId": str(data.get("threadId") or ""),
                    "internetMessageId": str(message.get("Message-ID") or "")[:500],
                },
            }
        )
        imported += 1
    await service._business_core.mark_synced(str(connection), str(workspace))
    return {"imported": imported, "scanned": len(listing.get("messages", []))}
