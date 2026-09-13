export interface PublishableOutboxEvent {
  id: string;
  workspace_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: Date | string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Older foundation events stored only their business data in `payload`. Keep
 * those pending rows publishable during an upgrade while all new writers use
 * the canonical v1 envelope.
 */
export function canonicalEventEnvelope(event: PublishableOutboxEvent): Record<string, unknown> {
  if (event.payload.schemaVersion === 1 && event.payload.eventId) return event.payload;
  const { correlationId: legacyCorrelationId, ...data } = event.payload;
  const correlationId = typeof legacyCorrelationId === "string" && UUID_PATTERN.test(legacyCorrelationId)
    ? legacyCorrelationId
    : event.id;
  return {
    schemaVersion: 1,
    eventId: event.id,
    workspaceId: event.workspace_id,
    aggregateType: event.aggregate_type,
    aggregateId: event.aggregate_id,
    actorUserId: null,
    occurredAt: event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at,
    correlationId,
    causationId: null,
    data,
  };
}
