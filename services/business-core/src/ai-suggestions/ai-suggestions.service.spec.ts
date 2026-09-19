import { ConflictException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestActor } from "../auth/actor";
import { AiSuggestionsService } from "./ai-suggestions.service";

const workspaceId = "f81e8362-8d08-440a-89dd-06ec7a8b46e7";
const suggestionId = "8b87894d-f8ea-42ea-9c69-58733e04d2b3";
const actor: RequestActor = { subject: "local:staff", provider: "local", email: "staff@example.com", displayName: "Staff" };
const base = {
  id: suggestionId,
  entityType: "lead",
  entityId: "ecdf2b57-c501-4f2f-bfa8-2fa369687b0f",
  title: "Enquiry review",
  suggestionText: "Schedule a follow-up.",
  evidence: [{ label: "Next action", value: "Missing", source: "CRM" }],
  proposedDiff: [{ field: "nextActionAt", label: "Next action", before: "Missing", after: "Choose a date" }],
  uncertainty: ["No date was inferred."],
  provenance: { mode: "rules" },
  status: "pending",
  editedText: null,
  version: 1,
};

function setup(handler: (sql: string, values?: unknown[]) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>) {
  const query = vi.fn(handler);
  const client = { query };
  const access = { withPermission: vi.fn(async (_actor, _workspace, _permission, work) => work(client, { userId: "26798624-b49d-4ed1-a3fc-6ae92039d175" })) };
  const events = { record: vi.fn().mockResolvedValue("event") };
  return { query, access, events, service: new AiSuggestionsService(access as never, events as never) };
}

describe("AiSuggestionsService", () => {
  it("creates an evidence-backed suggestion without updating the source record", async () => {
    const { service, query, access, events } = setup(async (sql) => {
      if (sql.includes("FROM crm_leads")) return { rowCount: 1, rows: [{ exists: true }] };
      if (sql.includes("FROM ai_suggestions WHERE") && sql.includes("request_id")) return { rowCount: 0, rows: [] };
      if (sql.includes("INSERT INTO ai_suggestions")) return { rowCount: 1, rows: [base] };
      return { rowCount: 0, rows: [] };
    });
    const input = { requestId: "38151564-a25c-4e33-a3a2-7285a2a2991f", entityType: "lead" as const, entityId: base.entityId, title: base.title, suggestionText: base.suggestionText, evidence: base.evidence, proposedDiff: base.proposedDiff, uncertainty: base.uncertainty, provenance: base.provenance };
    await expect(service.create(actor, workspaceId, input)).resolves.toMatchObject({ id: suggestionId, status: "pending" });
    expect(access.withPermission).toHaveBeenCalledWith(actor, workspaceId, "ai.suggestions.use", expect.any(Function));
    expect(query.mock.calls.some(([sql]) => /UPDATE\s+crm_leads/i.test(String(sql)))).toBe(false);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai.suggestion.created.v1", source: "system" }));
  });

  it("records an edited staff decision and audits that no source record changed", async () => {
    const updated = { ...base, status: "edited", editedText: "Call tomorrow.", version: 2 };
    const { service, query, events } = setup(async (sql) => {
      if (sql.includes("ai_suggestion_decisions decision")) return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT * FROM ai_suggestions")) return { rowCount: 1, rows: [base] };
      if (sql.includes("UPDATE ai_suggestions")) return { rowCount: 1, rows: [updated] };
      return { rowCount: 1, rows: [] };
    });
    await expect(service.decide(actor, workspaceId, suggestionId, { requestId: "157173ed-27bf-4247-9366-370393474186", version: 1, action: "edited", editedText: "Call tomorrow." })).resolves.toMatchObject({ status: "edited", editedText: "Call tomorrow.", version: 2 });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO ai_suggestion_decisions"))).toBe(true);
    expect(query.mock.calls.some(([sql]) => /UPDATE\s+crm_leads/i.test(String(sql)))).toBe(false);
    expect(events.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai.suggestion.edited.v1", after: expect.objectContaining({ sourceRecordChanged: false }) }));
  });

  it("replays the same staff decision without a second write or audit event", async () => {
    const input = { requestId: "157173ed-27bf-4247-9366-370393474187", version: 1, action: "accepted" as const };
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const reviewed = { ...base, requestHash, status: "accepted", version: 2 };
    const { service, query, events } = setup(async (sql) => {
      if (sql.includes("ai_suggestion_decisions decision")) return { rowCount: 1, rows: [reviewed] };
      return { rowCount: 0, rows: [] };
    });

    await expect(service.decide(actor, workspaceId, suggestionId, input)).resolves.toMatchObject({ status: "accepted", version: 2 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => /INSERT|UPDATE/i.test(String(sql)))).toBe(false);
    expect(events.record).not.toHaveBeenCalled();
  });

  it("rejects a stale or already-reviewed suggestion", async () => {
    const { service } = setup(async (sql) => {
      if (sql.includes("ai_suggestion_decisions decision")) return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT * FROM ai_suggestions")) return { rowCount: 1, rows: [{ ...base, status: "accepted" }] };
      return { rowCount: 0, rows: [] };
    });
    await expect(service.decide(actor, workspaceId, suggestionId, { requestId: "25df4f04-6f49-4a49-bdac-c614123107fe", version: 1, action: "accepted" })).rejects.toBeInstanceOf(ConflictException);
  });
});
