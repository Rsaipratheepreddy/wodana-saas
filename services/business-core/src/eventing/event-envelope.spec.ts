import { describe, expect, it } from "vitest";
import { canonicalEventEnvelope, PublishableOutboxEvent } from "./event-envelope";

const row = (payload: Record<string, unknown>): PublishableOutboxEvent => ({
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "22222222-2222-4222-8222-222222222222",
  aggregate_type: "workspace",
  aggregate_id: "22222222-2222-4222-8222-222222222222",
  event_type: "workspace.created.v1",
  payload,
  attempts: 1,
  created_at: new Date("2026-09-05T00:00:00Z"),
});

describe("canonicalEventEnvelope", () => {
  it("upgrades pending legacy outbox payloads without losing business data", () => {
    expect(canonicalEventEnvelope(row({ name: "Global workspace", correlationId: "33333333-3333-4333-8333-333333333333" }))).toEqual({
      schemaVersion: 1,
      eventId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      aggregateType: "workspace",
      aggregateId: "22222222-2222-4222-8222-222222222222",
      actorUserId: null,
      occurredAt: "2026-09-05T00:00:00.000Z",
      correlationId: "33333333-3333-4333-8333-333333333333",
      causationId: null,
      data: { name: "Global workspace" },
    });
  });

  it("preserves canonical envelopes exactly", () => {
    const envelope = { schemaVersion: 1, eventId: row({}).id, data: { ok: true } };
    expect(canonicalEventEnvelope(row(envelope))).toBe(envelope);
  });
});
