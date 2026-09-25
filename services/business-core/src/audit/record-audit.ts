import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

type Db = Pick<PoolClient, "query">;

/** One audited change: an immutable audit event plus the matching outbox event, in the caller's transaction. */
export async function recordAudit(db: Db, change: {
  workspaceId: string; actorUserId: string | null; action: string; entityType: string; entityId: string;
  before?: unknown; after?: unknown; source?: "user" | "internal";
}) {
  const eventId = randomUUID();
  const correlationId = randomUUID();
  const occurredAt = new Date().toISOString();
  await db.query(
    `INSERT INTO audit_events (id, workspace_id, actor_user_id, source, action, entity_type, entity_id, before, after, correlation_id, occurred_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [eventId, change.workspaceId, change.actorUserId, change.source ?? "user", change.action, change.entityType, change.entityId,
      change.before ?? null, change.after ?? null, correlationId, occurredAt],
  );
  await db.query(
    `INSERT INTO outbox_events (id, workspace_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1, $2, $3, $4, $5, $6)`,
    [eventId, change.workspaceId, change.entityType, change.entityId, change.action, {
      schemaVersion: 1, eventId, workspaceId: change.workspaceId, aggregateType: change.entityType, aggregateId: change.entityId,
      actorUserId: change.actorUserId, occurredAt, correlationId, causationId: null, data: change.after ?? {},
    }],
  );
}
