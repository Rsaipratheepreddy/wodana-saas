import base64
import hashlib
import json
import secrets
from collections.abc import Mapping
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import Any, cast
from uuid import UUID, uuid4

from cryptography.fernet import Fernet

from wodana_intelligence.config import Settings
from wodana_intelligence.integrations.business_core import BusinessCoreClient, BusinessCoreError
from wodana_intelligence.integrations.google_service import IntegrationFlowError
from wodana_intelligence.integrations.provider_client import SCOPES, ZOHO_REGIONS, ProviderClient
from wodana_intelligence.integrations.provider_models import (
    InvoiceRequest,
    OperationRequest,
    Provider,
    ProviderCredential,
    ProviderStartRequest,
    ProviderState,
    Region,
    WhatsAppCompleteRequest,
    WhatsAppMessageRequest,
)


class ProviderService:
    def __init__(
        self, settings: Settings, client: ProviderClient, core: BusinessCoreClient, redis: Any
    ) -> None:
        self.settings, self.client, self.core, self.redis = settings, client, core, redis
        self.cipher = Fernet(
            base64.urlsafe_b64encode(
                hashlib.sha256(settings.integrations_encryption_key.encode()).digest()
            )
        )

    def seal(self, data: dict[str, Any]) -> str:
        return self.cipher.encrypt(json.dumps(data, default=str).encode()).decode()

    def open(self, value: str) -> dict[str, Any]:
        return cast(dict[str, Any], json.loads(self.cipher.decrypt(value.encode())))

    async def start(
        self, provider: Provider, request: ProviderStartRequest, headers: Mapping[str, str]
    ) -> dict[str, Any]:
        public = await self.core.validate_connection(
            str(request.workspace_id), str(request.connection_id), headers
        )
        if public.get("provider") != provider:
            raise IntegrationFlowError("invalid_provider", "Connection belongs to another provider")
        if not self.client.configured(provider):
            raise IntegrationFlowError(
                "provider_not_configured",
                f"Configure the platform’s {provider} application credentials first",
                503,
            )
        connected = await self.core.request_connection(
            str(request.workspace_id), str(request.connection_id), request.version, headers
        )
        state = ProviderState(
            workspace_id=request.workspace_id,
            connection_id=request.connection_id,
            version=connected["version"],
            provider=provider,
            region=public.get("configuration", {}).get("region", "us"),
            issued_at=datetime.now(timezone.utc),
        )
        nonce = secrets.token_urlsafe(32)
        await self.redis.set(
            f"wodana:provider-oauth:{nonce}",
            self.seal(state.model_dump(mode="json")),
            ex=600,
            nx=True,
        )
        if provider == "whatsapp":
            return {
                "state": nonce,
                "appId": self.settings.whatsapp_app_id,
                "configId": self.settings.whatsapp_config_id,
                "version": self.settings.whatsapp_graph_version,
                "connectionVersion": connected["version"],
                "mode": "embedded_signup",
            }
        return {
            "authorizationUrl": self.client.authorization_url(provider, state.region, nonce),
            "connectionVersion": connected["version"],
            "expiresInSeconds": 600,
        }

    async def consume(self, provider: Provider, nonce: str) -> ProviderState:
        if not nonce or len(nonce) > 200:
            raise IntegrationFlowError(
                "invalid_oauth_state", "Connection link is invalid or expired"
            )
        value = await self.redis.getdel(f"wodana:provider-oauth:{nonce}")
        if not value:
            raise IntegrationFlowError(
                "invalid_oauth_state", "Connection link is invalid or expired"
            )
        state = ProviderState.model_validate(self.open(value))
        if state.provider != provider:
            raise IntegrationFlowError("invalid_provider", "OAuth provider does not match")
        return state

    async def fail(self, state: ProviderState, code: str) -> None:
        with suppress(Exception):
            await self.core.fail_connection(
                str(state.connection_id),
                {
                    "workspaceId": str(state.workspace_id),
                    "expectedVersion": state.version,
                    "errorCode": code,
                },
            )

    async def complete(
        self, provider: Provider, nonce: str, code: str, error: str, realm_id: str = ""
    ) -> dict[str, Any]:
        state = await self.consume(provider, nonce)
        try:
            if error or not code:
                raise IntegrationFlowError("oauth_denied", "Provider authorization was cancelled")
            token = await self.client.token(provider, state.region, code=code)
            credential = self.credential(provider, state.region, token)
            if not credential.refresh_token:
                raise IntegrationFlowError(
                    "offline_access_missing", "Reconnect and grant offline access"
                )
            if provider == "quickbooks":
                if not realm_id.isdigit():
                    raise IntegrationFlowError(
                        "company_missing", "QuickBooks did not identify a company"
                    )
                credential.account_id = realm_id
                credential.configuration = {"environment": self.settings.quickbooks_environment}
                company = await self.client.api(credential, "GET", f"/companyinfo/{realm_id}")
                credential.configuration["accountName"] = company["CompanyInfo"]["CompanyName"]
                preferences = await self.client.api(credential, "GET", "/preferences")
                home_currency = (
                    preferences.get("Preferences", {})
                    .get("CurrencyPrefs", {})
                    .get("HomeCurrency", {})
                    .get("value")
                )
                if home_currency:
                    credential.configuration["currency"] = str(home_currency).upper()
            else:
                data = await self.client.request(
                    "GET",
                    f"https://{ZOHO_REGIONS[state.region][1]}/books/v3/organizations",
                    headers={"Authorization": f"Zoho-oauthtoken {credential.access_token}"},
                )
                organizations = data.get("organizations", [])
                runtime = await self.core.runtime_context(
                    str(state.workspace_id), str(state.connection_id)
                )
                selected_id = str(runtime.get("configuration", {}).get("organizationId", ""))
                choices = (
                    [org for org in organizations if str(org["organization_id"]) == selected_id]
                    if selected_id
                    else organizations
                )
                if len(choices) != 1:
                    raise IntegrationFlowError(
                        "organization_required",
                        "Enter the Zoho Books organization ID in settings, then reconnect",
                    )
                organization = choices[0]
                credential.account_id = str(organization["organization_id"])
                credential.configuration = {
                    "region": state.region,
                    "accountName": organization["name"],
                    "currency": organization.get("currency_code"),
                }
            return await self.save_connection(state, credential)
        except Exception as exc:
            await self.fail(
                state, exc.code if isinstance(exc, IntegrationFlowError) else "oauth_failed"
            )
            raise

    def credential(
        self, provider: Provider, region: Region, token: dict[str, Any]
    ) -> ProviderCredential:
        expires = token.get("expires_in")
        return ProviderCredential(
            provider=provider,
            region=region,
            access_token=token["access_token"],
            refresh_token=token.get("refresh_token", ""),
            scopes=SCOPES[provider],
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=int(expires))
            if expires
            else None,
        )

    async def complete_whatsapp(
        self, request: WhatsAppCompleteRequest, headers: Mapping[str, str]
    ) -> dict[str, Any]:
        # Validate the actor before consuming the one-time state; SDK account IDs remain untrusted.
        await self.core.validate_connection(
            str(request.workspace_id), str(request.connection_id), headers
        )
        state = await self.consume("whatsapp", request.state)
        if (
            state.workspace_id != request.workspace_id
            or state.connection_id != request.connection_id
        ):
            raise IntegrationFlowError(
                "invalid_oauth_state", "Authorization belongs to another connection"
            )
        try:
            credential = self.credential(
                "whatsapp", "us", await self.client.token("whatsapp", "us", code=request.code)
            )
            debug = await self.client.request(
                "GET",
                f"{self.client.graph}/debug_token",
                params={"input_token": credential.access_token},
                headers={
                    "Authorization": (
                        f"Bearer {self.settings.whatsapp_app_id}|"
                        f"{self.settings.whatsapp_app_secret}"
                    )
                },
            )
            details = debug.get("data", {})
            targets = {
                str(target)
                for scope in details.get("granular_scopes", [])
                if scope.get("scope") == "whatsapp_business_management"
                for target in scope.get("target_ids", [])
            }
            if (
                not details.get("is_valid")
                or str(details.get("app_id")) != self.settings.whatsapp_app_id
                or request.waba_id not in targets
                or not set(SCOPES["whatsapp"]).issubset(set(details.get("scopes", [])))
            ):
                raise IntegrationFlowError(
                    "whatsapp_account_mismatch",
                    "Meta has not granted access to this WhatsApp Business account",
                )
            credential.account_id = request.waba_id
            phones = await self.client.api(
                credential,
                "GET",
                f"/{request.waba_id}/phone_numbers",
                params={
                    "fields": "id,display_phone_number,verified_name,code_verification_status",
                    "limit": 100,
                },
            )
            selected = next(
                (
                    phone
                    for phone in phones.get("data", [])
                    if str(phone["id"]) == request.phone_number_id
                ),
                None,
            )
            if not selected:
                raise IntegrationFlowError(
                    "whatsapp_phone_mismatch", "The selected sender does not belong to this account"
                )
            phone_status = await self.client.api(
                credential,
                "GET",
                f"/{request.phone_number_id}",
                params={"fields": "status,is_on_biz_app"},
            )
            if phone_status.get("status") != "CONNECTED":
                if phone_status.get("is_on_biz_app"):
                    raise IntegrationFlowError(
                        "whatsapp_coexistence_pending",
                        "Complete Meta's Business app coexistence setup before reconnecting",
                        409,
                    )
                if not request.registration_pin:
                    raise IntegrationFlowError(
                        "whatsapp_registration_required",
                        "This number needs Cloud API registration. "
                        "Reconnect with its six-digit PIN",
                        409,
                    )
                registration = await self.client.api(
                    credential,
                    "POST",
                    f"/{request.phone_number_id}/register",
                    json={"messaging_product": "whatsapp", "pin": request.registration_pin},
                )
                if registration.get("success") is not True:
                    raise IntegrationFlowError(
                        "whatsapp_registration_failed",
                        "Meta did not confirm sender registration",
                        409,
                    )
            if details.get("expires_at"):
                credential.expires_at = datetime.fromtimestamp(
                    details["expires_at"], tz=timezone.utc
                )
            credential.configuration = {
                "phoneNumberId": request.phone_number_id,
                "displayPhoneNumber": selected.get("display_phone_number"),
                "accountName": selected.get("verified_name"),
            }
            await self.client.api(
                credential, "POST", f"/{request.waba_id}/subscribed_apps", json={}
            )
            return await self.save_connection(state, credential)
        except Exception as exc:
            await self.fail(
                state, exc.code if isinstance(exc, IntegrationFlowError) else "oauth_failed"
            )
            raise

    async def save_connection(
        self, state: ProviderState, credential: ProviderCredential
    ) -> dict[str, Any]:
        # Use a unique credential generation, so a stale callback cannot overwrite an active token.
        reference = (
            f"redis:provider:{state.provider}:{state.workspace_id}:{state.connection_id}:{uuid4()}"
        )
        await self.redis.set(reference, self.seal(credential.model_dump(mode="json")))
        try:
            result = await self.core._internal_request(
                "POST",
                f"/internal/integrations/{state.connection_id}/provider/complete",
                json={
                    "workspaceId": str(state.workspace_id),
                    "expectedVersion": state.version,
                    "provider": state.provider,
                    "externalAccountId": credential.account_id,
                    "grantedScopes": credential.scopes,
                    "secretReference": reference,
                    "configuration": credential.configuration,
                    **(
                        {"tokenExpiresAt": credential.expires_at.isoformat()}
                        if credential.expires_at
                        else {}
                    ),
                },
            )
        except BusinessCoreError as error:
            if error.status_code < 500:
                await self.redis.delete(reference)
            raise
        # Webhook routing contains only identifiers; provider signatures are verified before lookup.
        await self.redis.sadd(
            f"wodana:provider-routing:{state.provider}:{credential.account_id}",
            f"{state.workspace_id}:{state.connection_id}",
        )
        return result

    async def webhook_routes(self, provider: str, account: str) -> set[str]:
        key = f"wodana:provider-routing:{provider}:{account}"
        routes = await self.redis.smembers(key)
        if routes:
            return set(routes)
        # The routing index is a cache. Recover only from existing credential references
        # whose owning connection is still active and matches the signed provider account.
        scanned = 0
        async for reference in self.redis.scan_iter(
            match=f"redis:provider:{provider}:*", count=100
        ):
            scanned += 1
            if scanned > 1000:
                raise IntegrationFlowError(
                    "routing_unavailable", "Webhook routing is recovering", 503
                )
            parts = reference.split(":")
            if len(parts) != 6:
                continue
            workspace, connection = parts[3], parts[4]
            try:
                UUID(workspace)
                UUID(connection)
            except ValueError:
                continue
            try:
                runtime = await self.core.runtime_context(workspace, connection)
            except BusinessCoreError as error:
                if error.status_code == 404:
                    continue
                raise
            if (runtime.get("status") == "connected"
                    and runtime.get("provider") == provider
                    and runtime.get("externalAccountId") == account
                    and runtime.get("secretReference") == reference):
                route = f"{workspace}:{connection}"
                await self.redis.sadd(key, route)
                routes.add(route)
        if not routes:
            # Do not acknowledge messages that cannot be delivered. Meta can retry them.
            raise IntegrationFlowError("routing_unavailable", "Webhook routing is unavailable", 503)
        return set(routes)

    async def runtime(
        self, workspace: str, connection: str, headers: Mapping[str, str], *, write: bool = False
    ) -> tuple[dict[str, Any], ProviderCredential]:
        await self.core._request(
            "POST",
            f"/workspaces/{workspace}/integration-connections/{connection}/authorize-use",
            headers=headers,
            json={"access": "write" if write else "read"},
        )
        runtime = await self.core.runtime_context(workspace, connection)
        return await self.credential_runtime(workspace, connection, runtime)

    async def credential_runtime(
        self, workspace: str, connection: str, runtime: dict[str, Any]
    ) -> tuple[dict[str, Any], ProviderCredential]:
        if runtime["status"] != "connected" or runtime["provider"] not in SCOPES:
            raise IntegrationFlowError(
                "connection_unavailable", "Reconnect this provider before using it", 409
            )
        reference = str(runtime.get("secretReference", ""))
        if not reference.startswith(
            f"redis:provider:{runtime['provider']}:{workspace}:{connection}:"
        ):
            raise IntegrationFlowError("credential_missing", "Reconnect this provider", 409)
        value = await self.redis.get(reference)
        if not value:
            raise IntegrationFlowError("credential_missing", "Reconnect this provider", 409)
        credential = ProviderCredential.model_validate(self.open(value))
        if credential.expires_at and credential.expires_at <= datetime.now(
            timezone.utc
        ) + timedelta(seconds=90):
            if not credential.refresh_token:
                raise IntegrationFlowError(
                    "reconnect_required", "Provider access expired; reconnect this account", 409
                )
            # Serialize refresh rotation; the lease exceeds the HTTP timeout.
            lease = f"{reference}:refresh"
            owner = secrets.token_hex(16)
            if not await self.redis.set(lease, owner, nx=True, ex=60):
                raise IntegrationFlowError(
                    "refresh_in_progress", "Connection is refreshing; try again shortly", 409
                )
            try:
                fresh = await self.redis.get(reference)
                credential = ProviderCredential.model_validate(self.open(fresh))
                if credential.expires_at and credential.expires_at <= datetime.now(
                    timezone.utc
                ) + timedelta(seconds=90):
                    token = await self.client.token(
                        credential.provider, credential.region, refresh=credential.refresh_token
                    )
                    credential.access_token = token["access_token"]
                    credential.refresh_token = (
                        token.get("refresh_token") or credential.refresh_token
                    )
                    credential.expires_at = datetime.now(timezone.utc) + timedelta(
                        seconds=int(token.get("expires_in", 3600))
                    )
                    await self.redis.set(reference, self.seal(credential.model_dump(mode="json")))
            finally:
                await self.redis.eval(
                    "if redis.call('get',KEYS[1]) == ARGV[1] then "
                    "return redis.call('del',KEYS[1]) else return 0 end",
                    1,
                    lease,
                    owner,
                )
        return runtime, credential

    async def runtime_internal(
        self, workspace: str, provider: Provider, connection: str | None = None
    ) -> tuple[dict[str, Any], ProviderCredential]:
        runtime = (await self.core.runtime_context(workspace, connection)
                   if connection else await self.core.provider_runtime(workspace, provider))
        if runtime["provider"] != provider:
            raise IntegrationFlowError(
                "connection_mismatch", "The linked accounting provider changed", 409
            )
        return await self.credential_runtime(workspace, str(runtime["id"]), runtime)

    async def send_whatsapp_notification(
        self, workspace: str, request: OperationRequest
    ) -> dict[str, Any]:
        runtime, credential = await self.runtime_internal(workspace, "whatsapp")
        payload = WhatsAppMessageRequest.model_validate(request.payload)
        key = f"wodana:provider-operation:{workspace}:{runtime['id']}:{request.idempotency_key}"
        digest = hashlib.sha256(
            request.model_dump_json(exclude={"idempotency_key"}).encode()
        ).hexdigest()
        saved = await self.redis.get(key)
        if saved:
            previous = self.open(saved)
            if previous["hash"] != digest:
                raise IntegrationFlowError(
                    "idempotency_conflict",
                    "This request key was already used for different content",
                    409,
                )
            if "result" in previous:
                return cast(dict[str, Any], previous["result"])
            raise IntegrationFlowError(
                "operation_unconfirmed",
                "This may have reached WhatsApp. Check the conversation before retrying.",
                409,
            )
        if not await self.redis.set(
            key, self.seal({"hash": digest, "state": "processing"}), nx=True
        ):
            raise IntegrationFlowError("operation_in_progress", "Message is processing", 409)
        result = await self.client.send_template(credential, payload)
        await self.redis.set(key, self.seal({"hash": digest, "result": result}))
        await self.core.record_activity(
            str(runtime["id"]), workspace, "message.send", result["id"],
            {"status": result["status"], "operationId": str(request.idempotency_key)},
        )
        return result

    async def revoke(
        self, workspace: str, connection: str, version: int, headers: Mapping[str, str]
    ) -> dict[str, Any]:
        await self.core.validate_connection(workspace, connection, headers)
        runtime = await self.core.runtime_context(workspace, connection)
        result = await self.core.revoke_connection(workspace, connection, version, headers)
        reference = runtime.get("secretReference")
        if reference:
            # Local disconnection must succeed even when the provider is unavailable.
            await self.redis.delete(reference)
        if runtime.get("externalAccountId"):
            await self.redis.srem(
                f"wodana:provider-routing:{runtime['provider']}:{runtime['externalAccountId']}",
                f"{workspace}:{connection}",
            )
        return result

    async def records(
        self, workspace: str, connection: str, kind: str, page: int, headers: Mapping[str, str]
    ) -> dict[str, Any]:
        operation = f"provider.records.{kind}"
        try:
            _, credential = await self.runtime(workspace, connection, headers)
            result = await self.client.list_records(credential, kind, page)
            await self.core.record_health(connection, workspace, operation, True)
            return result
        except Exception as error:
            with suppress(Exception):
                await self.core.record_health(
                    connection, workspace, operation, False,
                    (
                        error.code
                        if isinstance(error, IntegrationFlowError)
                        else "provider_unavailable"
                    ),
                )
            raise

    async def invoice(
        self, workspace: str, connection: str, invoice_id: str, headers: Mapping[str, str]
    ) -> dict[str, Any]:
        operation = "provider.invoice.read"
        try:
            _, credential = await self.runtime(workspace, connection, headers)
            if credential.provider == "whatsapp":
                raise IntegrationFlowError("invalid_provider", "Select an accounting connection")
            result = await self.client.invoice(credential, invoice_id)
            await self.core.record_activity(
                connection,
                workspace,
                "accounting.invoice_refreshed",
                invoice_id,
                {"balance": result.get("balance"), "status": result.get("status")},
            )
            await self.core.record_health(connection, workspace, operation, True)
            return result
        except Exception as error:
            with suppress(Exception):
                await self.core.record_health(
                    connection, workspace, operation, False,
                    (
                        error.code
                        if isinstance(error, IntegrationFlowError)
                        else "provider_unavailable"
                    ),
                )
            raise

    async def media(
        self, workspace: str, connection: str, media_id: str, headers: Mapping[str, str]
    ) -> tuple[bytes, str]:
        _, credential = await self.runtime(workspace, connection, headers)
        if credential.provider != "whatsapp":
            raise IntegrationFlowError("invalid_provider", "Select a WhatsApp connection")
        metadata = await self.client.api(credential, "GET", f"/{media_id}")
        url = str(metadata.get("url", ""))
        if not url.startswith("https://"):
            raise IntegrationFlowError("media_unavailable", "WhatsApp media is unavailable", 404)
        response = await self.client.http.get(
            url, headers={"Authorization": f"Bearer {credential.access_token}"}
        )
        if response.is_error:
            raise IntegrationFlowError(
                "media_download_failed",
                "WhatsApp media could not be downloaded",
                response.status_code,
            )
        if len(response.content) > 20 * 1024 * 1024:
            raise IntegrationFlowError("media_too_large", "WhatsApp media exceeds 20 MB", 413)
        return response.content, str(metadata.get("mime_type") or "application/octet-stream")

    async def execute(
        self, workspace: str, connection: str, request: OperationRequest, headers: Mapping[str, str]
    ) -> dict[str, Any]:
        _, credential = await self.runtime(workspace, connection, headers, write=True)
        if request.action == "invoice.create" and credential.provider in (
            "quickbooks",
            "zoho_books",
        ):
            invoice = InvoiceRequest.model_validate(request.payload)
            if credential.provider == "zoho_books":
                # Zoho invoices inherit customer currency. Never silently bill in a different one.
                customer = await self.client.api(
                    credential, "GET", f"/contacts/{invoice.customer_id}"
                )
                if customer.get("contact", {}).get("currency_code") != invoice.currency:
                    raise IntegrationFlowError(
                        "currency_mismatch", "The selected customer uses a different currency"
                    )
            action_payload: Any = invoice
        elif request.action == "message.send" and credential.provider == "whatsapp":
            action_payload = WhatsAppMessageRequest.model_validate(request.payload)
        else:
            raise IntegrationFlowError(
                "invalid_operation", "This action is not supported by the selected connection"
            )
        key = f"wodana:provider-operation:{workspace}:{connection}:{request.idempotency_key}"
        digest = hashlib.sha256(
            request.model_dump_json(exclude={"idempotency_key"}).encode()
        ).hexdigest()
        saved = await self.redis.get(key)
        if saved:
            previous = self.open(saved)
            if previous["hash"] != digest:
                raise IntegrationFlowError(
                    "idempotency_conflict",
                    "This request key was already used for different content",
                    409,
                )
            if "result" in previous:
                cached = cast(dict[str, Any], previous["result"])
                await self.core.record_activity(
                    connection,
                    workspace,
                    request.action,
                    cached["id"],
                    {"status": cached["status"], "operationId": str(request.idempotency_key)},
                )
                return cached
            raise IntegrationFlowError(
                "operation_unconfirmed",
                "This may have reached the provider. Check its records before sending again.",
                409,
            )
        # No expiry: do not blindly retry ambiguous provider writes.
        if not await self.redis.set(
            key, self.seal({"hash": digest, "state": "processing"}), nx=True
        ):
            raise IntegrationFlowError(
                "operation_in_progress", "This request is already processing", 409
            )
        if request.action == "invoice.create":
            result = await self.client.create_invoice(
                credential, action_payload, str(request.idempotency_key)
            )
        else:
            result = await self.client.send_template(credential, action_payload)
        await self.redis.set(
            key, self.seal({"hash": digest, "state": "completed", "result": result})
        )
        await self.core.record_activity(
            connection,
            workspace,
            request.action,
            result["id"],
            {"status": result["status"], "operationId": str(request.idempotency_key)},
        )
        return result
