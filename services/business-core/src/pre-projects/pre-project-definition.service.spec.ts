import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import type { RequestActor } from "../auth/actor";
import type { CrmEventsService } from "../crm/shared/crm-events.service";
import { canonicalHash } from "../crm/shared/crm-types";
import type { WorkspaceAccessService } from "../workspaces/workspace-access.service";
import { PreProjectDefinitionService } from "./pre-project-definition.service";

const workspaceId = "123e4567-e89b-42d3-a456-426614174000";
const caseId = "223e4567-e89b-42d3-a456-426614174000";
const baselineId = "323e4567-e89b-42d3-a456-426614174000";
const challengeId = "423e4567-e89b-42d3-a456-426614174000";
const grant = {
  id: "523e4567-e89b-42d3-a456-426614174000",
  name: "Client Approver",
  role: "approver",
};
const portalInput = {
  baselineId,
  decision: "accept" as const,
  note: "",
  challengeId,
};
const actor = {
  subject: "definition-user",
  email: "definition@example.com",
  displayName: "Definition User",
  provider: "development",
} as RequestActor;

function serviceWith(
  query: ReturnType<typeof vi.fn> = vi.fn(),
  caseStatus = "active",
) {
  const access = {
    withPermissions: vi.fn(
      async (_actor, _workspaceId, _permissions, callback) =>
        callback({ query }, { userId: "user-1", displayName: "Definition User" }),
    ),
  };
  const events = { record: vi.fn() };
  const service = new PreProjectDefinitionService(
    access as unknown as WorkspaceAccessService,
    events as unknown as CrmEventsService,
  );
  const client = { query } as unknown as PoolClient;
  const available = vi
    .spyOn(service as never, "assertDecisionAvailable" as never)
    .mockResolvedValue({ publishedAt: "2026-09-15T10:00:00.000Z" } as never);
  const lockResponse = { rowCount: 1, rows: [{ status: caseStatus }] };
  return { service, client, query, access, events, available, lockResponse };
}

describe("PreProjectDefinitionService decisions", () => {
  it("rejects viewers and malformed definition IDs before database work", async () => {
    const { service, client, query } = serviceWith();
    await expect(
      service.decidePortal(
        client,
        workspaceId,
        caseId,
        { ...grant, role: "viewer" },
        portalInput,
        vi.fn(),
      ),
    ).rejects.toThrow("designated approver");
    await expect(
      service.decidePortal(
        client,
        workspaceId,
        caseId,
        grant,
        { ...portalInput, baselineId: "not-a-uuid" },
        vi.fn(),
      ),
    ).rejects.toThrow("valid definition version");
    expect(query).not.toHaveBeenCalled();
  });

  it("serializes a client decision and changes nothing for an invalid OTP", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("FOR UPDATE")
        ? { rowCount: 1, rows: [{ status: "active" }] }
        : { rowCount: 0, rows: [] },
    );
    const { service, client, available, events } = serviceWith(query);
    const verify = vi.fn(async () => null);
    await expect(
      service.decidePortal(
        client,
        workspaceId,
        caseId,
        grant,
        portalInput,
        verify,
      ),
    ).resolves.toEqual({ invalidCode: true });
    expect(String(query.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(available).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("INSERT INTO pre_project_definition_decisions"),
      ),
    ).toBe(false);
    expect(events.record).not.toHaveBeenCalled();
  });

  it("records the verified client identity and OTP evidence once", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("FOR UPDATE")
        ? { rowCount: 1, rows: [{ status: "active" }] }
        : sql.includes("challenge_id=$2")
          ? { rowCount: 0, rows: [] }
          : { rowCount: 1, rows: [] },
    );
    const { service, client, events } = serviceWith(query);
    await expect(
      service.decidePortal(
        client,
        workspaceId,
        caseId,
        grant,
        portalInput,
        async () => "+971555555555",
      ),
    ).resolves.toEqual({ ok: true, replayed: false, decision: "confirmed" });
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO pre_project_definition_decisions"),
    );
    expect(insert?.[1]).toEqual([
      expect.any(String),
      workspaceId,
      caseId,
      baselineId,
      null,
      expect.any(String),
      "confirmed",
      grant.name,
      "client_portal",
      "",
      `Verified client portal OTP challenge ${challengeId}`,
      expect.any(Date),
      null,
      grant.id,
      challengeId,
    ]);
    expect(events.record).toHaveBeenCalledOnce();
  });

  it("replays the same client decision without consuming another OTP", async () => {
    const requestHash = canonicalHash({
      caseId,
      grantId: grant.id,
      ...portalInput,
      decision: "confirmed",
    });
    const query = vi.fn(async (sql: string) =>
      sql.includes("FOR UPDATE")
        ? { rowCount: 1, rows: [{ status: "released" }] }
        : {
            rowCount: 1,
            rows: [{ requestHash, decision: "confirmed" }],
          },
    );
    const { service, client, available } = serviceWith(query);
    const verify = vi.fn();
    await expect(
      service.decidePortal(
        client,
        workspaceId,
        caseId,
        grant,
        portalInput,
        verify,
      ),
    ).resolves.toEqual({ ok: true, replayed: true, decision: "confirmed" });
    expect(available).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it("keeps an exact staff retry valid after the Preparation closes", async () => {
    const input = {
      requestId: "623e4567-e89b-42d3-a456-426614174000",
      decision: "confirmed" as const,
      decisionBy: "Client Approver",
      channel: "email" as const,
      note: "",
      evidence: "Confirmation email received",
      decidedAt: "2026-09-15T10:05:00.000Z",
    };
    const requestHash = canonicalHash({ baselineId, ...input });
    const query = vi.fn(async (sql: string) =>
      sql.includes("FOR UPDATE")
        ? { rowCount: 1, rows: [{ status: "released" }] }
        : { rowCount: 1, rows: [{ requestHash, decision: "confirmed" }] },
    );
    const { service, events, available } = serviceWith(query);
    await expect(
      service.recordDecision(actor, workspaceId, caseId, baselineId, input),
    ).resolves.toEqual({ ok: true, replayed: true, decision: "confirmed" });
    expect(available).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("requires staff-recorded change requests to include the client's remarks", async () => {
    const query = vi.fn(async (sql: string) =>
      sql.includes("FOR UPDATE")
        ? { rowCount: 1, rows: [{ status: "active" }] }
        : { rowCount: 0, rows: [] },
    );
    const { service, events, available } = serviceWith(query);
    await expect(
      service.recordDecision(actor, workspaceId, caseId, baselineId, {
        requestId: "923e4567-e89b-42d3-a456-426614174000",
        decision: "changes_requested",
        decisionBy: "Client Approver",
        channel: "phone",
        note: "",
        evidence: "Call recording reference",
        decidedAt: "2026-09-15T10:05:00.000Z",
      }),
    ).rejects.toThrow("Describe the changes required");
    expect(available).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it("does not expose internal decision evidence in client portal data", async () => {
    const { service, client } = serviceWith();
    vi.spyOn(service as never, "capture" as never).mockResolvedValue({
      sourceHash: "s".repeat(64),
      issues: [],
      caseStatus: "active",
      snapshot: {},
    } as never);
    vi.spyOn(service as never, "latest" as never).mockResolvedValue({
      id: baselineId,
      caseId,
      number: 1,
      requestId: "723e4567-e89b-42d3-a456-426614174000",
      requestHash: "r".repeat(64),
      sourceHash: "s".repeat(64),
      snapshotHash: "h".repeat(64),
      snapshot: {},
      message: "Please confirm",
      supersedesId: null,
      publishedAt: "2026-09-15T10:00:00.000Z",
      publishedBy: "Designer",
      decisionId: "823e4567-e89b-42d3-a456-426614174000",
      decision: "confirmed",
      decisionBy: "Client Approver",
      decisionChannel: "client_portal",
      decisionNote: "",
      decisionEvidence: "internal OTP challenge reference",
      decidedAt: "2026-09-15T10:05:00.000Z",
    } as never);
    const result = await service.portalData(
      client,
      workspaceId,
      caseId,
      grant,
    );
    expect(result?.decision).not.toHaveProperty("evidence");
    expect(result?.canDecide).toBe(false);
  });
});
