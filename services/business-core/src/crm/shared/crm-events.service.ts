import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";
import { DomainChange } from "./crm-types";

@Injectable()
export class CrmEventsService {
  async record(client: PoolClient, change: DomainChange): Promise<string> {
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const correlationId = change.correlationId ?? randomUUID();
    const payload = {
      schemaVersion: 1,
      eventId,
      workspaceId: change.workspaceId,
      aggregateType: change.entityType,
      aggregateId: change.entityId,
      actorUserId: change.actorUserId,
      occurredAt,
      correlationId,
      causationId: change.causationId ?? null,
      data: change.after ?? {},
    };

    await client.query(
      `INSERT INTO audit_events
        (id, workspace_id, actor_user_id, source, action, entity_type, entity_id,
         before, after, correlation_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        eventId,
        change.workspaceId,
        change.actorUserId,
        change.source,
        change.action,
        change.entityType,
        change.entityId,
        change.before ?? null,
        change.after ?? null,
        correlationId,
        occurredAt,
      ],
    );
    await client.query(
      `INSERT INTO outbox_events
        (id, workspace_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [eventId, change.workspaceId, change.entityType, change.entityId, change.action, payload],
    );
    return eventId;
  }
}
