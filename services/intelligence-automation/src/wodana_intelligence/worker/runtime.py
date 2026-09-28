import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import ValidationError

from wodana_intelligence.integrations.business_core import BusinessCoreClient
from wodana_intelligence.worker.adapters import NotificationAdapter
from wodana_intelligence.worker.models import DeliveryJob, DomainEventV1, PushReceiptJob

logger = logging.getLogger("wodana.worker.runtime")


class CrmWorker:
    stream = "wodana:domain-events"
    dead_letter_stream = "wodana:domain-events:dead-letter"
    # Read by Business Core's /health/ready (keep the key in step with health.controller.ts).
    heartbeat_key = "wodana:worker:heartbeat"
    heartbeat_ttl_seconds = 86_400

    def __init__(
        self,
        redis_client: Any,
        business_core: BusinessCoreClient,
        adapter: NotificationAdapter,
        group: str,
        consumer: str,
    ) -> None:
        self.redis = redis_client
        self.business_core = business_core
        self.adapter = adapter
        self.group = group
        self.consumer = consumer

    async def ensure_group(self) -> None:
        try:
            await self.redis.xgroup_create(self.stream, self.group, id="0", mkstream=True)
        except Exception as error:
            if "BUSYGROUP" not in str(error):
                raise

    async def consume_once(self, block_ms: int = 1000) -> int:
        response = await self.redis.xreadgroup(
            self.group,
            self.consumer,
            {self.stream: ">"},
            count=20,
            block=block_ms,
        )
        handled = 0
        for _stream, messages in response:
            for message_id, fields in messages:
                if await self._handle(fields):
                    await self.redis.xack(self.stream, self.group, message_id)
                    handled += 1
        return handled

    async def recover_pending(self) -> int:
        response = await self.redis.xautoclaim(
            self.stream, self.group, self.consumer, min_idle_time=60_000, start_id="0-0", count=20
        )
        messages = response[1] if len(response) > 1 else []
        handled = 0
        for message_id, fields in messages:
            if await self._handle(fields):
                await self.redis.xack(self.stream, self.group, message_id)
                handled += 1
        return handled

    async def _handle(self, fields: dict[str, str]) -> bool:
        try:
            event = self._event_from_fields(fields)
            event_type = fields["eventType"]
            workspace_id = str(event.workspace_id)
            if event_type == "notification.delivery_requested.v1":
                await self.drain_notifications(workspace_id)
                await self.business_core.dispatch_staff_emails(workspace_id)
            if event_type == "automation.approval.decided.v1":
                run_id = event.data.get("runId")
                step_key = event.data.get("stepKey")
                if run_id and step_key:
                    if event.data.get("status") == "approved":
                        run = await self.business_core.automation_run_context(
                            workspace_id, str(run_id)
                        )
                        await self._execute_safe(
                            workspace_id,
                            run,
                            run.get("definition", {}),
                            resume_after=str(step_key),
                        )
                    else:
                        await self.business_core.advance_automation_run(
                            str(run_id),
                            {
                                "workspaceId": workspace_id,
                                "stepKey": f"{step_key}.rejected",
                                "attempt": 1,
                                "status": "cancelled",
                                "output": {"approvalRejected": True},
                            },
                        )
                return True
            await self.start_matching_automations(event_type, event)
            return True
        except (KeyError, ValueError, ValidationError) as error:
            logger.error("Permanent invalid event: %s", error)
            try:
                await self.redis.xadd(
                    self.dead_letter_stream,
                    {
                        "reason": str(error)[:2000],
                        "failedAt": datetime.now(timezone.utc).isoformat(),
                        "event": json.dumps(fields, ensure_ascii=False),
                    },
                    maxlen=10_000,
                    approximate=True,
                )
                return True
            except Exception:
                logger.exception("Unable to persist invalid event to dead letter stream")
                return False
        except Exception:
            logger.exception("Transient event handling failure")
            return False

    @staticmethod
    def _event_from_fields(fields: dict[str, str]) -> DomainEventV1:
        payload = json.loads(fields["payload"])
        if not isinstance(payload, dict):
            raise ValueError("Event payload must be a JSON object")
        if payload.get("schemaVersion") == 1 and payload.get("eventId"):
            return DomainEventV1.model_validate(payload)

        # Compatibility for stream entries published before the canonical
        # envelope was enforced. This lets an upgraded worker drain them once.
        correlation_id = payload.pop("correlationId", None) or fields["eventId"]
        return DomainEventV1.model_validate(
            {
                "schemaVersion": 1,
                "eventId": fields["eventId"],
                "workspaceId": fields["workspaceId"],
                "aggregateType": fields["aggregateType"],
                "aggregateId": fields["aggregateId"],
                "actorUserId": None,
                "occurredAt": fields.get("occurredAt", datetime.now(timezone.utc).isoformat()),
                "correlationId": correlation_id,
                "causationId": None,
                "data": payload,
            }
        )

    async def start_matching_automations(self, event_type: str, event: DomainEventV1) -> None:
        matches = await self.business_core.matching_automations(str(event.workspace_id), event_type)
        for match in matches:
            run = await self.business_core.start_automation_run(
                str(match["id"]),
                {
                    "workspaceId": str(event.workspace_id),
                    "triggerEventId": str(event.event_id),
                    "aggregateType": event.aggregate_type,
                    "aggregateId": str(event.aggregate_id),
                    "correlationId": str(event.correlation_id),
                    "causationId": str(event.event_id),
                    "context": {"eventType": event_type, "event": event.data},
                },
            )
            await self._execute_safe(str(event.workspace_id), run, match.get("definition", {}))

    async def _execute_safe(
        self,
        workspace_id: str,
        run: dict[str, Any],
        definition: Any,
        resume_after: str | None = None,
    ) -> None:
        run_id = str(run["id"])
        try:
            nodes = definition.get("nodes", []) if isinstance(definition, dict) else []
            edges = definition.get("edges", []) if isinstance(definition, dict) else []
            node_map = {
                str(node["key"]): node
                for node in nodes
                if isinstance(node, dict) and isinstance(node.get("key"), str)
            }
            outgoing: dict[str, list[dict[str, Any]]] = {}
            for edge in edges:
                if isinstance(edge, dict) and isinstance(edge.get("from"), str):
                    outgoing.setdefault(str(edge["from"]), []).append(edge)
            trigger = next(
                (node for node in node_map.values() if node.get("type") == "trigger"), None
            )
            origin = resume_after or (str(trigger["key"]) if trigger else "")
            queue = [
                str(edge["to"])
                for edge in outgoing.get(origin, [])
                if isinstance(edge.get("to"), str)
            ]
            visits: dict[str, int] = {}
            visit_limit = self._workflow_visit_limit(node_map)
            context = run.get("context", {})
            while queue:
                key = queue.pop(0)
                node = node_map.get(key)
                if node is None:
                    raise ValueError(f"Unknown automation node: {key}")
                visits[key] = visits.get(key, 0) + 1
                if visits[key] > visit_limit:
                    raise ValueError(f"Automation iteration limit exceeded at {key}")
                key = str(node.get("key", "unknown"))
                node_type = str(node.get("type", ""))
                configuration = node.get("configuration", {})
                configuration = configuration if isinstance(configuration, dict) else {}
                if node_type == "end":
                    await self.business_core.advance_automation_run(
                        run_id,
                        {
                            "workspaceId": workspace_id,
                            "stepKey": key,
                            "attempt": visits[key],
                            "status": "completed",
                            "output": {"completed": True},
                        },
                    )
                    return
                if node_type in {"delay_until", "sla_timer"}:
                    resolved_delay = self._resolve_value(configuration, context)
                    if not isinstance(resolved_delay, dict):
                        raise ValueError("Automation delay configuration must resolve to an object")
                    due_at = self._due_at(resolved_delay)
                    await self.business_core.advance_automation_run(
                        run_id,
                        {
                            "workspaceId": workspace_id,
                            "stepKey": key,
                            "attempt": visits[key],
                            "status": "waiting",
                            "dueAt": due_at,
                        },
                    )
                    return
                if node_type == "request_approval":
                    await self.business_core.advance_automation_run(
                        run_id,
                        {
                            "workspaceId": workspace_id,
                            "stepKey": key,
                            "attempt": visits[key],
                            "status": "approval_required",
                            "proposedAction": configuration,
                            "requestedFromMembershipId": configuration.get(
                                "requestedFromMembershipId"
                            ),
                        },
                    )
                    return
                if node_type in {
                    "assign",
                    "create_task",
                    "update_record",
                    "enroll_sequence",
                    "stop_sequence",
                    "send_template",
                    "emit_webhook",
                    "create_project_handoff",
                }:
                    await self.business_core.execute_automation_step(
                        run_id,
                        {
                            "workspaceId": workspace_id,
                            "stepKey": key,
                            "attempt": visits[key],
                        },
                    )
                else:
                    await self.business_core.advance_automation_run(
                        run_id,
                        {
                            "workspaceId": workspace_id,
                            "stepKey": key,
                            "attempt": visits[key],
                            "status": "step_completed",
                            "output": {
                                "orchestrated": True,
                                "nodeType": node_type,
                                "lookupValue": self._path(
                                    context, str(configuration.get("path", ""))
                                )
                                if node_type == "lookup"
                                else None,
                            },
                        },
                    )
                selected = self._next_edges(
                    node_type,
                    configuration,
                    outgoing.get(key, []),
                    context,
                    visits[key],
                )
                queue = [str(edge["to"]) for edge in selected] + queue
            await self.business_core.advance_automation_run(
                run_id,
                {
                    "workspaceId": workspace_id,
                    "stepKey": "workflow.end",
                    "attempt": 1,
                    "status": "completed",
                    "output": {"completed": True, "implicitEnd": True},
                },
            )
        except Exception as error:
            await self.business_core.advance_automation_run(
                run_id,
                {
                    "workspaceId": workspace_id,
                    "stepKey": "workflow.failure",
                    "attempt": 1,
                    "status": "failed",
                    "failureCode": "WORKER_EXECUTION_FAILED",
                    "failureMessage": str(error)[:2000],
                },
            )

    async def whatsapp_templates(self, workspace_id: str) -> None:
        """Submits starter templates to Meta and, once a day, stores every template's Meta status."""
        submit = getattr(self.adapter, "submit_whatsapp_template", None)
        list_all = getattr(self.adapter, "whatsapp_templates", None)
        if submit is None or list_all is None:
            return
        work_for = getattr(self.business_core, "whatsapp_template_work", None)
        if work_for is None:
            return
        work = await work_for(workspace_id)
        for template in work.get("submissions", []):
            try:
                created = await submit(workspace_id, template)
                result: dict[str, Any] = {"providerTemplateId": created["id"], "status": created["status"]}
            except Exception as error:  # Meta refused it: the reason is stored and the owner told.
                result = {"error": str(getattr(error, "message", error))[:500] or "Meta refused the template"}
            await self.business_core.whatsapp_template_submitted(workspace_id, str(template["id"]), result)
        if work.get("sync"):
            try:
                templates = await list_all(workspace_id)
            except Exception:
                logger.warning("WhatsApp template sync failed for %s; retrying within the hour", workspace_id)
                return
            await self.business_core.whatsapp_templates_synced(workspace_id, templates, True)

    async def drain_notifications(self, workspace_id: str) -> int:
        jobs = await self.business_core.claim_notification_jobs(workspace_id)
        delivered = 0
        for item in jobs:
            job = DeliveryJob.model_validate(item)
            result = await self.adapter.deliver(job)
            await self.business_core.record_notification_result(
                str(job.id),
                {
                    "workspaceId": workspace_id,
                    "attempt": job.attempt,
                    "provider": result.provider,
                    "result": result.result,
                    "providerMessageId": result.provider_message_id,
                    "errorCode": result.error_code,
                    "errorMessage": result.error_message,
                    "endpointReference": result.endpoint_reference,
                },
            )
            delivered += result.result == "delivered"
        claim_receipts = getattr(self.business_core, "claim_push_receipts", None)
        record_receipt = getattr(self.business_core, "record_push_receipt", None)
        if claim_receipts and record_receipt:
            for item in await claim_receipts(workspace_id):
                receipt = PushReceiptJob.model_validate(item)
                verified = await self.adapter.verify_push(receipt)
                await record_receipt(
                    str(receipt.notification_id),
                    {
                        "workspaceId": workspace_id,
                        "attempt": receipt.attempt,
                        "providerMessageId": receipt.provider_message_id,
                        "result": verified.result,
                        "errorCode": verified.error_code,
                        "errorMessage": verified.error_message,
                    },
                )
                delivered += verified.result == "delivered"
        return delivered

    async def beat(self) -> None:
        """Proves the timer loop runs; Business Core's readiness reports it stale otherwise."""
        try:
            await self.redis.set(
                self.heartbeat_key,
                json.dumps(
                    {"at": datetime.now(timezone.utc).isoformat(), "consumer": self.consumer}
                ),
                ex=self.heartbeat_ttl_seconds,
            )
        except Exception:  # the heartbeat never stops the worker's real work
            logger.warning("Worker heartbeat could not be written")

    async def poll_due_work(self) -> None:
        while True:
            await self.beat()
            # Reclaim transient failures continuously. A dependency can become
            # unavailable after startup, so a one-time recovery pass is not enough.
            await self.recover_pending()
            for workspace_id in await self.business_core.due_crm_workspaces():
                await self.beat()  # a long pass over many workspaces is still alive
                await self.business_core.process_due_slas(workspace_id)
                await self.business_core.process_due_takeovers(workspace_id)
                await self.business_core.process_due_sequences(workspace_id)
                await self.business_core.wake_snoozed_conversations(workspace_id)
                await self.business_core.run_payment_reminders(workspace_id)
                await self.whatsapp_templates(workspace_id)
                await self.drain_notifications(workspace_id)
                await self.business_core.dispatch_staff_emails(workspace_id)
                waits = await self.business_core.claim_automation_waits(workspace_id)
                for wait in waits:
                    run = await self.business_core.automation_run_context(
                        workspace_id, str(wait["runId"])
                    )
                    await self._execute_safe(
                        workspace_id,
                        run,
                        run.get("definition", {}),
                        resume_after=str(wait["stepKey"]),
                    )
                    await self.business_core.complete_automation_wait(
                        str(wait["id"]), workspace_id, str(wait["claimToken"])
                    )
            await asyncio.sleep(5)

    @staticmethod
    def _due_at(configuration: dict[str, Any]) -> str:
        value = configuration.get("dueAt")
        if value:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError("Automation delay dueAt must include a timezone")
            offset = configuration.get("offsetMinutes", 0)
            if not isinstance(offset, (int, float)) or abs(offset) > 525_600:
                raise ValueError("Automation delay offsetMinutes must be within one year")
            return (parsed + timedelta(minutes=float(offset))).isoformat()
        minutes = configuration.get("delayMinutes", configuration.get("minutes"))
        if not isinstance(minutes, (int, float)) or minutes < 0:
            raise ValueError("Automation delay requires dueAt or non-negative delayMinutes")
        return (datetime.now(timezone.utc) + timedelta(minutes=float(minutes))).isoformat()

    @classmethod
    def _resolve_value(cls, value: Any, context: Any) -> Any:
        if isinstance(value, list):
            return [cls._resolve_value(item, context) for item in value]
        if isinstance(value, dict):
            return {key: cls._resolve_value(item, context) for key, item in value.items()}
        if isinstance(value, str) and value.startswith("$"):
            return cls._path(context, value)
        return value

    @staticmethod
    def _workflow_visit_limit(nodes: dict[str, dict[str, Any]]) -> int:
        limits = []
        for node in nodes.values():
            configuration = node.get("configuration", {})
            if node.get("type") == "bounded_iteration" and isinstance(configuration, dict):
                value = configuration.get("maxIterations", 1)
                if isinstance(value, int) and 1 <= value <= 100:
                    limits.append(value)
        return max(limits, default=1)

    @classmethod
    def _next_edges(
        cls,
        node_type: str,
        configuration: dict[str, Any],
        edges: list[dict[str, Any]],
        context: Any,
        visit: int,
    ) -> list[dict[str, Any]]:
        if node_type == "filter":
            passed = cls._condition(configuration.get("condition", configuration), context)
            labelled = [
                edge for edge in edges if str(edge.get("when", "")).lower() == str(passed).lower()
            ]
            return labelled or ([edges[0]] if passed and edges else [])
        if node_type == "branch":
            for edge in edges:
                if "condition" in edge and cls._condition(edge["condition"], context):
                    return [edge]
            defaults = [edge for edge in edges if edge.get("default") is True]
            return defaults[:1]
        if node_type == "bounded_iteration":
            max_iterations = int(configuration.get("maxIterations", 1))
            label = "continue" if visit < max_iterations else "done"
            return [edge for edge in edges if str(edge.get("when", "")).lower() == label][:1]
        return edges

    @classmethod
    def _condition(cls, condition: Any, context: Any) -> bool:
        if not isinstance(condition, dict):
            return bool(condition)
        if isinstance(condition.get("all"), list):
            return all(cls._condition(item, context) for item in condition["all"])
        if isinstance(condition.get("any"), list):
            return any(cls._condition(item, context) for item in condition["any"])
        actual = cls._path(context, str(condition.get("path", "")))
        expected = condition.get("value")
        operator = str(condition.get("operator", "equals"))
        if operator == "equals":
            return bool(actual == expected)
        if operator == "not_equals":
            return bool(actual != expected)
        if operator == "exists":
            return actual is not None
        if operator == "in":
            return isinstance(expected, list) and actual in expected
        if operator == "not_in":
            return isinstance(expected, list) and actual not in expected
        if operator == "contains":
            return isinstance(actual, (str, list, dict)) and expected in actual
        if operator in {"gt", "gte", "lt", "lte"}:
            comparisons = {
                "gt": lambda: actual > expected,
                "gte": lambda: actual >= expected,
                "lt": lambda: actual < expected,
                "lte": lambda: actual <= expected,
            }
            try:
                return bool(comparisons[operator]())
            except TypeError:
                return False
        raise ValueError(f"Unsupported automation condition operator: {operator}")

    @staticmethod
    def _path(value: Any, path: str) -> Any:
        current = value
        for segment in path.removeprefix("$").removeprefix("context.").split("."):
            if not segment:
                continue
            if not isinstance(current, dict):
                return None
            current = current.get(segment)
        return current
